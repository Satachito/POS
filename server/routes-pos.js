//	POS API for the floor handies and the kitchen display.
//
//	Every write is idempotent on an id the terminal generates. A handy that sends an order
//	and loses the response in a Wi-Fi hole can simply repeat the request: it gets the first
//	result back, and the kitchen never sees the same order twice.
//
//	The terminal is not trusted with money. It sends item codes and quantities; prices, tax
//	rates and every total are resolved and computed here, from the menu clusters.
//
//		GET   /pos/menu[?v=hash]            menu snapshot, versioned by content hash
//		GET   /pos/tables                   every table with its open order
//		POST  /pos/order                    open a table              (idempotent: order_id)
//		GET   /pos/order/{order_id}         the order, its tickets and the running bill
//		POST  /pos/order/{order_id}/close   settle                    (an order closes once)
//		POST  /pos/ticket                   send to the kitchen       (idempotent: ticket_id)
//		POST  /pos/ticket/{ticket_id}/void  cancel one line, audited
//		GET   /pos/kds[?station=]           what the kitchen still owes
//		POST  /pos/kds/{ticket_id}          advance a line, or the whole ticket
//		GET   /pos/sales/{YYYY-MM-DD}       day total
//		GET   /pos/events                   SSE: ticket / kds / order / menu

import {
	Send
,	SendJSONable
,	BodyAsJSON
,	QueryOf
,	_400
,	_404
,	_405
} from './jsonables.js'

import { Subscribe, Broadcast, ClientCount } from './events.js'

const
Fail = ( status, message, detail ) => { throw Object.assign( new Error( message ), { status, detail } ) }

//	Local ISO with offset: sortable as a string, and readable in a git diff at 2am.
const
Now = () => {
	const
	d	= new Date()
,	o	= -d.getTimezoneOffset()
,	P	= ( n, w = 2 ) => String( Math.floor( Math.abs( n ) ) ).padStart( w, '0' )
	return `${ d.getFullYear() }-${ P( d.getMonth() + 1 ) }-${ P( d.getDate() ) }`
	+	`T${ P( d.getHours() ) }:${ P( d.getMinutes() ) }:${ P( d.getSeconds() ) }`
	+	`${ o < 0 ? '-' : '+' }${ P( o / 60 ) }:${ P( o % 60 ) }`
}

const
Today = () => Now().slice( 0, 10 )

//	----------------------------------------------------------------- money

const
Amount = line => ( line.price + line.options.reduce( ( n, o ) => n + o.price, 0 ) ) * line.qty

//	Menu prices are tax-inclusive, the way they are printed on a Japanese menu. The tax
//	component is reported per rate and computed once on that rate's subtotal -- not summed
//	per line -- which is how it has to appear on a qualified invoice.
const
Bill = ( tickets, discount = 0 ) => {
	const
	perRate = new Map()
	let
	subtotal = 0

	for ( const t of tickets ) for ( const line of t.lines ) {
		if ( line.state === 'void' ) continue
		const
		amount = Amount( line )
		subtotal += amount
		perRate.set( line.tax, ( perRate.get( line.tax ) ?? 0 ) + amount )
	}

	discount = Math.max( 0, Math.min( discount, subtotal ) )

	//	A discount lowers the tax base, so it is apportioned across the rates it covers
	//	rather than shaved off the total: a bill mixing 8% and 10% has to stay reportable.
	const
	tax = [ ...perRate ]
	.map( ( [ rate, sub ] ) => ( { rate, base: subtotal ? sub - Math.round( discount * sub / subtotal ) : 0 } ) )
	.map( _ => ( { ..._, amount: Math.round( _.base * _.rate / ( 100 + _.rate ) ) } ) )
	.sort( ( a, b ) => b.rate - a.rate )

	return { subtotal, discount, total: subtotal - discount, tax }
}

//	----------------------------------------------------------------- derived indexes

//	Rebuilt from the clusters at boot and never persisted, so they cannot drift from what
//	is on disk. This is also why an order does not store its own list of tickets: a crash
//	between the two writes would leave a ticket off the bill, and nobody would notice.
const
BuildIndex = pos => {
	const
	byOrder	= new Map()	//	order_id → ticket_id[]
,	openOf	= new Map()	//	table code → order_id

	for ( const t of pos.tickets.all() ) {
		if ( !byOrder.has( t.order_id ) ) byOrder.set( t.order_id, [] )
		byOrder.get( t.order_id ).push( t.ticket_id )
	}
	for ( const o of pos.orders.all() ) if ( !o.closed_at ) openOf.set( o.table, o.order_id )

	return { byOrder, openOf }
}

//	----------------------------------------------------------------- menu

const
MenuOf = pos => {
	const
	By = _ => ( a, b ) => ( a[ _ ] ?? 0 ) - ( b[ _ ] ?? 0 ) || String( a.code ).localeCompare( b.code )
	return {
		categories	: [ ...pos.categories.all()	].sort( By( 'order' ) )
	,	items		: [ ...pos.items.all()		].sort( By( 'order' ) )
	,	tables		: [ ...pos.tables.all()		].sort( By( 'order' ) )
	}
}

//	The version is a hash of the menu itself, so there is no version counter to forget to
//	bump. Edit an item through /db/ or by hand in the .jsons and the hash simply moves.
const
VersionOf = async menu => {
	const
	{ createHash } = await import( 'crypto' )
	return createHash( 'sha1' ).update( JSON.stringify( menu ) ).digest( 'hex' ).slice( 0, 12 )
}

//	----------------------------------------------------------------- lines

const
ResolveLines = ( pos, requested ) => {
	if ( !Array.isArray( requested ) || !requested.length ) Fail( 400, 'lines is empty' )

	const
	soldOut = []
,	lines = requested.map( ( _, i ) => {
		const
		item = pos.items.get( String( _.item ) )
		if ( !item ) Fail( 400, `No such item: ${ _.item }` )
		if ( item.sold_out ) soldOut.push( item.code )

		const
		qty = Number( _.qty )
		if ( !Number.isInteger( qty ) || qty < 1 ) Fail( 400, `Bad qty for ${ item.code }` )

		//	Option prices come from the item, never from the handy: a stale menu cache must
		//	not be able to move money.
		const
		options = ( _.options ?? [] ).map( code => {
			const
			option = ( item.options ?? [] ).find( o => o.code === code )
			if ( !option ) Fail( 400, `No such option on ${ item.code }: ${ code }` )
			return { code: option.code, name: option.name, price: option.price ?? 0 }
		} )

		return {
			no		: i + 1
		,	item	: item.code
		,	name	: item.name
		,	qty
		,	price	: item.price
		,	tax		: item.tax ?? 10
		,	station	: item.station ?? 'kitchen'
		,	options
		,	note	: String( _.note ?? '' )
		,	state	: 'queued'
		}
	} )

	if ( soldOut.length ) Fail( 409, 'Sold out', { sold_out: soldOut } )
	return lines
}

const
TicketState = ticket => {
	const
	live = ticket.lines.filter( _ => _.state !== 'void' )
	if ( !live.length )							return 'done'
	if ( live.every( _ => _.state === 'done' ) )	return 'done'
	if ( live.some( _ => _.state !== 'queued' ) )	return 'cooking'
	return 'queued'
}

//	----------------------------------------------------------------- orders

const
TicketsOf = ( pos, index, order_id ) =>
	( index.byOrder.get( order_id ) ?? [] )
	.map( _ => pos.tickets.get( _ ) )
	.filter( Boolean )
	.sort( ( a, b ) => a.seq - b.seq )

//	Human-readable slip number, MMDD-NNN, assigned here so it survives a retry: the handy
//	repeats its order_id, gets the stored order back, and the number never moves.
const
NextNumber = pos => {
	const
	prefix = Today().slice( 5 ).replace( '-', '' )
	let
	max = 0
	for ( const o of pos.orders.all() ) {
		if ( !String( o.number ).startsWith( `${ prefix }-` ) ) continue
		max = Math.max( max, Number( o.number.slice( -3 ) ) || 0 )
	}
	return `${ prefix }-${ String( max + 1 ).padStart( 3, '0' ) }`
}

const
OrderView = ( pos, index, order ) => {
	const
	tickets = TicketsOf( pos, index, order.order_id )
	return { ...order, tickets, bill: order.bill ?? Bill( tickets ) }
}

//	----------------------------------------------------------------- routes

export const
POSRoutes = pos => {

	const
	index = BuildIndex( pos )

	const
	Menu = async () => {
		const
		menu = MenuOf( pos )
		return { version: await VersionOf( menu ), ...menu }
	}

	const
	Tables = () => [ ...pos.tables.all() ].map( table => {
		const
		order_id = index.openOf.get( table.code )
		if ( !order_id ) return { ...table, order: null }

		const
		order	= pos.orders.get( order_id )
	,	tickets	= TicketsOf( pos, index, order_id )
		return {
			...table
		,	order: {
				order_id
			,	number		: order.number
			,	guests		: order.guests
			,	opened_at	: order.opened_at
			,	tickets		: tickets.length
			,	total		: Bill( tickets ).total
			}
		}
	} )

	const
	OpenOrder = async Q => {
		const
		body = await BodyAsJSON( Q )
		if ( !body.order_id ) Fail( 400, 'order_id is required' )

		//	Retry of a request whose response was lost: hand back what was stored.
		const
		known = pos.orders.get( body.order_id )
		if ( known ) return OrderView( pos, index, known )

		const
		table = pos.tables.get( String( body.table ) )
		if ( !table ) Fail( 400, `No such table: ${ body.table }` )

		const
		occupied = index.openOf.get( table.code )
		if ( occupied ) Fail( 409, `Table ${ table.code } is already open`, OrderView( pos, index, pos.orders.get( occupied ) ) )

		const
		order = {
			order_id	: String( body.order_id )
		,	number		: NextNumber( pos )
		,	table		: table.code
		,	guests		: Number( body.guests ) || 1
		,	terminal	: String( body.terminal ?? '' )
		,	opened_at	: Now()
		,	closed_at	: null
		,	bill		: null
		}
		pos.orders.insert( order.order_id, order )
		index.openOf.set( table.code, order.order_id )

		Broadcast( 'order', { action: 'open', order } )
		return OrderView( pos, index, order )
	}

	const
	SendTicket = async Q => {
		const
		body = await BodyAsJSON( Q )
		if ( !body.ticket_id ) Fail( 400, 'ticket_id is required' )

		const
		known = pos.tickets.get( body.ticket_id )
		if ( known ) return known

		const
		order = pos.orders.get( String( body.order_id ) )
		if ( !order )			Fail( 400, `No such order: ${ body.order_id }` )
		if ( order.closed_at )	Fail( 409, `Order ${ order.number } is already closed` )

		const
		lines = ResolveLines( pos, body.lines )

		const
		ticket = {
			ticket_id	: String( body.ticket_id )
		,	order_id	: order.order_id
		,	number		: order.number
		,	table		: order.table
		,	terminal	: String( body.terminal ?? '' )
		,	seq			: ( index.byOrder.get( order.order_id )?.length ?? 0 ) + 1
		,	at			: Now()
		,	state		: 'queued'
		,	lines
		}

		//	Cluster first, index after: the durable write is the one that counts, and the
		//	index is rebuilt from it at every boot anyway.
		pos.tickets.insert( ticket.ticket_id, ticket )
		if ( !index.byOrder.has( order.order_id ) ) index.byOrder.set( order.order_id, [] )
		index.byOrder.get( order.order_id ).push( ticket.ticket_id )

		Broadcast( 'ticket', ticket )
		return ticket
	}

	const
	VoidLine = async ( Q, ticket_id ) => {
		const
		body	= await BodyAsJSON( Q )
	,	ticket	= pos.tickets.get( ticket_id )
		if ( !ticket ) Fail( 404, `No such ticket: ${ ticket_id }` )

		const
		line = ticket.lines.find( _ => _.no === Number( body.line ) )
		if ( !line ) Fail( 400, `No such line: ${ body.line }` )

		//	Already void: the retry is a no-op, not an error.
		if ( line.state !== 'void' ) {
			line.state	= 'void'
			line.void	= { at: Now(), by: String( body.terminal ?? '' ), reason: String( body.reason ?? '' ) }
			ticket.state = TicketState( ticket )
			pos.tickets.replace( ticket_id, ticket )
			Broadcast( 'kds', ticket )
		}
		return ticket
	}

	const
	KDS = query => {
		const
		station = query.get( 'station' )
		return [ ...pos.tickets.all() ]
		.filter( _ => _.state !== 'done' )
		.map( _ => station ? { ..._, lines: _.lines.filter( l => l.station === station ) } : _ )
		.filter( _ => _.lines.length )
		.sort( ( a, b ) => a.at < b.at ? -1 : 1 )
	}

	const
	Advance = async ( Q, ticket_id ) => {
		const
		body	= await BodyAsJSON( Q )
	,	ticket	= pos.tickets.get( ticket_id )
		if ( !ticket ) Fail( 404, `No such ticket: ${ ticket_id }` )

		const
		state = String( body.state )
		if ( ![ 'queued', 'cooking', 'done' ].includes( state ) ) Fail( 400, `Bad state: ${ state }` )

		for ( const line of ticket.lines ) {
			if ( line.state === 'void' ) continue
			if ( body.line !== undefined && line.no !== Number( body.line ) ) continue
			if ( body.station !== undefined && line.station !== body.station ) continue
			line.state = state
		}
		ticket.state = TicketState( ticket )
		pos.tickets.replace( ticket_id, ticket )

		Broadcast( 'kds', ticket )
		return ticket
	}

	const
	Close = async ( Q, order_id ) => {
		const
		order = pos.orders.get( order_id )
		if ( !order ) Fail( 404, `No such order: ${ order_id }` )

		//	An order closes exactly once. That is the idempotency key -- a repeated close
		//	returns the bill that was actually settled, never a second one.
		if ( order.closed_at ) return OrderView( pos, index, order )

		const
		body		= await BodyAsJSON( Q )
	,	tickets		= TicketsOf( pos, index, order_id )
	,	payments	= ( body.payments ?? [] ).map( _ => ( { method: String( _.method ), amount: Number( _.amount ) || 0 } ) )
		if ( !payments.length ) Fail( 400, 'payments is empty' )

		//	Recomputed here from the tickets. Whatever total the handy showed is a display.
		const
		bill	= Bill( tickets, Number( body.discount ) || 0 )
	,	paid	= payments.reduce( ( n, _ ) => n + _.amount, 0 )
		if ( paid < bill.total ) Fail( 400, `Short payment: ${ paid } < ${ bill.total }`, bill )

		order.closed_at	= Now()
		order.bill		= {
			...bill
		,	payments
		,	paid
		,	change		: paid - bill.total
		,	note		: String( body.note ?? '' )
		,	terminal	: String( body.terminal ?? '' )
		}
		pos.orders.replace( order_id, order )
		index.openOf.delete( order.table )

		Broadcast( 'order', { action: 'close', order } )
		return OrderView( pos, index, order )
	}

	const
	Sales = date => {
		const
		orders = [ ...pos.orders.all() ].filter( _ => _.closed_at?.startsWith( date ) )

		const
		perRate	= new Map()
	,	byMethod	= {}
		let
		subtotal = 0, discount = 0, total = 0, guests = 0

		for ( const o of orders ) {
			subtotal	+= o.bill.subtotal
			discount	+= o.bill.discount
			total		+= o.bill.total
			guests		+= o.guests
			for ( const _ of o.bill.tax ) perRate.set( _.rate, ( perRate.get( _.rate ) ?? 0 ) + _.amount )
			for ( const _ of o.bill.payments ) byMethod[ _.method ] = ( byMethod[ _.method ] ?? 0 ) + _.amount
		}

		return {
			date
		,	orders	: orders.length
		,	guests
		,	subtotal
		,	discount
		,	total
		,	per_guest	: guests ? Math.round( total / guests ) : 0
		,	tax			: [ ...perRate ].map( ( [ rate, amount ] ) => ( { rate, amount } ) ).sort( ( a, b ) => b.rate - a.rate )
		,	by_method	: byMethod
		}
	}

	return {
		'/pos/': async ( Q, S, rest ) => {
			const
			[ head, a, b ] = rest.split( '/' )
		,	GET		= Q.method === 'GET'
		,	POST	= Q.method === 'POST'

			try {
				switch ( head ) {
				case 'menu': {
					if ( !GET ) return _405( S )
					const
					menu = await Menu()
					//	Unchanged? Say so in 40 bytes instead of resending the whole card.
					return SendJSONable( S, QueryOf( Q ).get( 'v' ) === menu.version ? { version: menu.version, changed: false } : { ...menu, changed: true } )
				}
				case 'tables':
					return GET ? SendJSONable( S, Tables() ) : _405( S )

				case 'order':
					if ( !a )					return POST	? SendJSONable( S, await OpenOrder( Q ) )	: _405( S )
					if ( b === 'close' )		return POST	? SendJSONable( S, await Close( Q, a ) )	: _405( S )
					if ( b )					return _404( S )
					if ( !GET )					return _405( S )
					{
						const
						order = pos.orders.get( a )
						return order ? SendJSONable( S, OrderView( pos, index, order ) ) : _404( S )
					}

				case 'ticket':
					if ( !a )					return POST	? SendJSONable( S, await SendTicket( Q ) )		: _405( S )
					if ( b === 'void' )			return POST	? SendJSONable( S, await VoidLine( Q, a ) )	: _405( S )
					return _404( S )

				case 'kds':
					if ( !a )					return GET	? SendJSONable( S, KDS( QueryOf( Q ) ) )		: _405( S )
					return POST ? SendJSONable( S, await Advance( Q, a ) ) : _405( S )

				case 'sales':
					return GET && a ? SendJSONable( S, Sales( a ) ) : _405( S )

				case 'events':
					return GET ? Subscribe( Q, S ) : _405( S )

				case 'health':
					return SendJSONable( S, {
						at			: Now()
					,	orders		: pos.orders.count()
					,	tickets		: pos.tickets.count()
					,	open		: index.openOf.size
					,	listeners	: ClientCount()
					} )

				default:
					return _404( S )
				}
			} catch ( e ) {
				if ( e instanceof SyntaxError ) return _400( S, e.message )
				return Send(
					S
				,	e.status ?? 500
				,	JSON.stringify( { error: e.message, detail: e.detail ?? null } )
				,	'application/json'
				)
			}
		}
	}
}
