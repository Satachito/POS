//	Key-addressed view over a JSONables MemoryCluster.
//
//	POS records reference each other by logical key (order_id / ticket_id / item code),
//	never by the cluster's internal id. Internal ids are re-derived when a cluster is
//	compacted back into its base file -- a record POSTed as `id-<uuid>` comes back as
//	`base-7` the next morning -- so anything that stored one would dangle after the
//	first close of business. Identity belongs to the cluster; the app uses logical keys.

export class
Keyed {

	constructor( cluster ) {
		this.cluster = cluster
	}

	get( key ) {
		const
		line = this.cluster.getByKey( key )
		return line === undefined ? null : JSON.parse( line )
	}

	has( key ) {
		return this.cluster.hasKey( key )
	}

	//	The idempotency primitive: insert unless the key is already there.
	//	Returns whichever record is now stored, and whether this call is the one that
	//	stored it -- a handy repeating a request over flaky Wi-Fi gets `created: false`
	//	and the original result, not a second order in the kitchen.
	insert( key, record ) {
		const
		existing = this.get( key )
		if ( existing ) return { record: existing, created: false }
		this.cluster.post( record )
		return { record, created: true }
	}

	replace( key, record ) {
		const
		id = this.cluster.logical.get( key )
		if ( id === undefined ) throw Object.assign( new Error( `No such key: ${ key }` ), { status: 404 } )
		this.cluster.put( id, record )
		return record
	}

	* all() {
		for ( const [ , line ] of this.cluster.scan() ) yield JSON.parse( line )
	}

	count() {
		return this.cluster.recordCount()
	}
}
