//	Server-Sent Events hub.
//
//	Bullet.js hands the handler the raw ServerResponse, so a stream is just a response we
//	never end -- no WebSocket library, no extra dependency. Three handies and one kitchen
//	display do not need more than this.

const
clients = new Set()

export const
Broadcast = ( event, data ) => {
	const
	frame = `event: ${ event }\ndata: ${ JSON.stringify( data ) }\n\n`
	for ( const S of clients ) S.write( frame )
}

export const
Subscribe = ( Q, S ) => {
	S.writeHead(
		200
	,	{	'Content-Type'		: 'text/event-stream'
		,	'Cache-Control'		: 'no-cache'
		,	'Connection'		: 'keep-alive'
		,	'X-Accel-Buffering'	: 'no'
		}
	)
	//	Tell the client to come back fast: a handy that walks behind the walk-in should
	//	reconnect the moment it has signal again.
	S.write( 'retry: 2000\n\n' )

	clients.add( S )
	Q.on( 'close', () => clients.delete( S ) )
}

export const
ClientCount = () => clients.size

//	Comment frames, so an idle stream is not dropped by Wi-Fi power saving or the AP's
//	idle timeout while the kitchen waits for the first order of the evening.
setInterval( () => { for ( const S of clients ) S.write( ': ping\n\n' ) }, 20000 ).unref()
