//	Close of business: fold each cluster's write log back into its base file.
//
//		node tools/compact.js
//
//	Why it is needed: AppendLog only ever appends, and load() replays the whole log at every
//	boot. A busy year is a hundred thousand lines of replay before the first table can be
//	opened. Compacting keeps startup flat and keeps the git history of data/pos readable.
//
//	Crash safety: the base file is written to a temporary and renamed over the old one, and
//	only then is the log truncated. A crash in between simply replays the log onto the new
//	base -- put operations are idempotent, so the result is identical either way.
//
//	Note: internal ids are re-derived from the base file on the next load (id-<uuid> becomes
//	base-N). Nothing may store one. The POS addresses records by logical key exactly so that
//	this operation stays free -- see server/keyed.js.

import fs	from 'fs'
import net	from 'net'
import path	from 'path'
import url	from 'url'

import { MemoryCluster } from '../server/jsonables.js'

const
ROOT	= path.resolve( path.dirname( url.fileURLToPath( import.meta.url ) ), '..' )
,	DATA	= path.join( ROOT, 'data', 'pos' )
,	PORT	= process.env.PORT || 8080

//	Compacting under a live server would drop anything it wrote between our read and the
//	truncate -- which is to say, an order. Stop the service first.
const
ServerIsUp = () => new Promise( R => {
	const
	socket = net.connect( { port: PORT, host: '127.0.0.1' } )
	socket.on( 'connect'	, () => ( socket.destroy(), R( true ) ) )
	socket.on( 'error'		, () => R( false ) )
	socket.setTimeout( 500, () => ( socket.destroy(), R( false ) ) )
} )

if ( await ServerIsUp() ) {
	console.error( `Something is listening on ${ PORT }. Stop the POS first:  sudo systemctl stop pos` )
	process.exit( 1 )
}

let
total = 0

for ( const file of fs.readdirSync( DATA ).filter( _ => _.endsWith( '.meta.json' ) ) ) {
	const
	table	= file.slice( 0, -'.meta.json'.length )
,	base	= path.join( DATA, `${ table }.jsons` )
,	log		= path.join( DATA, `${ table }.log.jsons` )

	const
	before = fs.existsSync( log ) ? fs.statSync( log ).size : 0
	if ( !before ) { console.log( `${ table.padEnd( 12 ) } -` ); continue }

	const
	cluster	= await new MemoryCluster( DATA, table ).load()
,	tmp		= `${ base }.tmp`
,	fd		= fs.openSync( tmp, 'w' )

	for ( const [ , line ] of cluster.scan() ) fs.writeSync( fd, line + '\n' )
	fs.fsyncSync( fd )
	fs.closeSync( fd )

	fs.renameSync( tmp, base )
	fs.truncateSync( log, 0 )

	total += before
	console.log( `${ table.padEnd( 12 ) } ${ String( cluster.recordCount() ).padStart( 7 ) } records, log ${ ( before / 1024 ).toFixed( 1 ) }KB folded in` )
}

console.log( `\n${ ( total / 1024 ).toFixed( 1 ) }KB of write log compacted. Commit data/pos now.` )
