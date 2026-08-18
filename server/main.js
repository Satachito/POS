//	POS server for a single restaurant: one Raspberry Pi, three handies, one kitchen display.
//
//		npm start                         http://localhost:8080/
//		POS_TOKEN=... PORT=8080 npm start
//
//	Layout:
//		/pos/...        the floor and kitchen API (routes-pos.js)
//		/db/pos/...     JSONables generic CRUD -- the menu admin surface, guarded
//		/apps/kds/      kitchen display, meant for Chromium in kiosk mode on the Pi itself
//		data/pos/*      every record, as text, one JSONable per line

import fs	from 'fs'
import path	from 'path'
import url	from 'url'

import {
	API_STATIC_SERVER
,	MemoryCluster
,	DBRoutes
,	_403
} from './jsonables.js'

import { Keyed }		from './keyed.js'
import { POSRoutes }	from './routes-pos.js'

const
ROOT	= path.resolve( path.dirname( url.fileURLToPath( import.meta.url ) ), '..' )
,	DATA	= path.join( ROOT, 'data', 'pos' )
,	TABLES	= [ 'tables', 'categories', 'items', 'orders', 'tickets' ]

const
clusters = {}
for ( const table of TABLES ) {
	if ( !fs.existsSync( path.join( DATA, `${ table }.meta.json` ) ) ) throw new Error( `Missing data/pos/${ table }.meta.json` )
	clusters[ table ] = await new MemoryCluster( DATA, table, { writable: true } ).load()
}

const
pos = Object.fromEntries( TABLES.map( _ => [ _, new Keyed( clusters[ _ ] ) ] ) )

console.log( TABLES.map( _ => `${ _ }(${ clusters[ _ ].recordCount() })` ).join( ' ' ) )

//	----------------------------------------------------------------- access

//	One shared token for the floor, because three handies on an isolated store VLAN do not
//	need per-device identity -- and localhost is always allowed, which is what lets the KDS
//	run in a kiosk browser on the Pi with no token in its URL at all.
const
TOKEN		= process.env.POS_TOKEN
,	ADMIN_TOKEN	= process.env.ADMIN_TOKEN

if ( !TOKEN ) console.warn( 'POS_TOKEN is not set: the API is open to anyone on the network. Development only.' )

const
Local = Q => [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ].includes( Q.socket.remoteAddress )

//	EventSource cannot set headers, so the stream also accepts the token in the query.
//	Acceptable on a store LAN with a static token; it does end up in access logs.
const
Presented = Q =>
	Q.headers[ 'x-pos-token' ]
	|| ( Q.headers.authorization ?? '' ).replace( /^Bearer /, '' )
	|| new URL( Q.url, 'http://localhost' ).searchParams.get( 'token' )

const
Guard = ( Allowed, handler ) => async ( Q, S, rest ) => Allowed( Q ) ? handler( Q, S, rest ) : _403( S )

const
Floor = Q => Local( Q ) || !TOKEN || Presented( Q ) === TOKEN

//	Generic CRUD is unauthenticated by design in JSONables: full POST/PUT/DELETE over every
//	cluster. That is right for a laptop tool and wrong on a store network, so it stays on the
//	Pi itself unless an ADMIN_TOKEN is deliberately set for a counter PC.
const
Admin = Q => Local( Q ) || ( !!ADMIN_TOKEN && Presented( Q ) === ADMIN_TOKEN )

//	----------------------------------------------------------------- serve

const
APIs = {
	...Object.fromEntries( Object.entries( POSRoutes( pos ) ).map( ( [ k, v ] ) => [ k, Guard( Floor, v ) ] ) )
,	...Object.fromEntries( Object.entries( DBRoutes( { pos: clusters } ) ).map( ( [ k, v ] ) => [ k, Guard( Admin, v ) ] ) )
,	'/data/': async ( Q, S ) => _403( S )	//	the raw .jsons are not served statically
}

const
PORT = process.env.PORT || 8080

API_STATIC_SERVER( APIs, ROOT ).listen( PORT, () => console.log( `POS: http://localhost:${ PORT }/apps/kds/` ) )
