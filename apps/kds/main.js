//	Kitchen display.
//
//	Meant to run in Chromium kiosk mode on the Pi itself, on a monitor the cooks can see:
//	served from localhost, so it needs no token. Reachable from elsewhere on the LAN with
//	?token=... if the display ever moves off the Pi.
//
//	State lives on the server. This page holds a ticket list, redraws it when SSE says
//	something changed, and refetches on reconnect -- so a display that was unplugged for
//	ten minutes comes back correct rather than stale.

const
TOKEN	= new URLSearchParams( location.search ).get( 'token' )
,	STATION	= new URLSearchParams( location.search ).get( 'station' )
,	WARN	= 8		//	minutes before a ticket starts asking for attention
,	LATE	= 15	//	minutes before it starts shouting

const
board		= document.getElementById( 'board' )
,	stations	= document.getElementById( 'stations' )
,	link		= document.getElementById( 'link' )

const
Query = extra => {
	const
	q = new URLSearchParams( extra )
	if ( TOKEN ) q.set( 'token', TOKEN )
	const s = q.toString()
	return s ? `?${ s }` : ''
}

const
API = async ( path, body ) => {
	const
	$ = await fetch( `/pos/${ path }${ Query() }`, body === undefined ? {} : { method: 'POST', body: JSON.stringify( body ) } )
	if ( !$.ok ) throw new Error( `${ $.status }: ${ await $.text() }` )
	return $.json()
}

let
tickets	= []
,	station	= STATION ?? ''

const
Minutes = at => Math.floor( ( Date.now() - new Date( at ) ) / 60000 )

const
Heat = m => m >= LATE ? 'late' : m >= WARN ? 'warn' : ''

const
Visible = _ => !station || _.lines.some( l => l.station === station && l.state !== 'void' )

const
Render = () => {
	const
	open = tickets.filter( _ => _.state !== 'done' && Visible( _ ) ).sort( ( a, b ) => a.at < b.at ? -1 : 1 )

	if ( !open.length ) {
		board.innerHTML = '<p class="empty">通っている注文はありません</p>'
		return
	}

	board.innerHTML = open.map( t => {
		const
		m		= Minutes( t.at )
	,	lines	= t.lines.filter( l => !station || l.station === station )
		return `
		<article class="ticket ${ Heat( m ) } ${ t.state }" data-ticket="${ t.ticket_id }">
			<div class="head">
				<span class="table">${ t.table }</span>
				<span class="slip">${ t.number } / ${ t.seq }回目</span>
				<span class="clock">${ m }分</span>
			</div>
			<ul>${ lines.map( l => `
				<li data-line="${ l.no }" data-state="${ l.state }">
					<span class="qty">${ l.qty }</span>
					<span>${ l.name }</span>
					${ l.options.map( o => `<span class="opt">${ o.name }</span>` ).join( '' ) }
					${ l.note ? `<span class="note">${ l.note }</span>` : '' }
				</li>` ).join( '' ) }</ul>
			<div class="foot"><button data-all="${ t.ticket_id }">全部提供</button></div>
		</article>`
	} ).join( '' )
}

//	Tap a line to serve it; the whole-ticket button is for when the tray goes out at once.
board.addEventListener( 'click', async e => {
	const
	all = e.target.closest( '[data-all]' )
	if ( all ) return Advance( all.dataset.all, {} )

	const
	li = e.target.closest( 'li[data-line]' )
	if ( !li || li.dataset.state === 'void' ) return
	Advance( li.closest( '[data-ticket]' ).dataset.ticket, { line: Number( li.dataset.line ) } )
} )

const
Advance = async ( ticket_id, where ) => {
	//	Optimistic: the cook sees the strike-through immediately, and the SSE echo of our own
	//	write confirms it a moment later. A failure refetches, so the screen never lies.
	try {
		Replace( await API( `kds/${ ticket_id }`, { state: 'done', ...where, ...( station ? { station } : {} ) } ) )
	} catch ( e ) {
		console.error( e )
		Reload()
	}
}

const
Replace = ticket => {
	const
	i = tickets.findIndex( _ => _.ticket_id === ticket.ticket_id )
	i < 0 ? tickets.push( ticket ) : tickets[ i ] = ticket
	Render()
}

const
Reload = async () => {
	tickets = await API( 'kds' )
	Render()
}

//	----------------------------------------------------------------- station filter

const
Stations = [ [ '', 'すべて' ], [ 'kitchen', '厨房' ], [ 'bar', 'ドリンク' ] ]

stations.innerHTML = Stations.map( ( [ v, label ] ) => `<button data-station="${ v }" aria-pressed="${ v === station }">${ label }</button>` ).join( '' )
stations.addEventListener( 'click', e => {
	const
	b = e.target.closest( '[data-station]' )
	if ( !b ) return
	station = b.dataset.station
	for ( const _ of stations.children ) _.setAttribute( 'aria-pressed', _.dataset.station === station )
	Render()
} )

//	----------------------------------------------------------------- live

const
Connect = () => {
	const
	source = new EventSource( `/pos/events${ Query() }` )

	source.onopen = () => {
		link.className = ''
		link.textContent = '接続'
		//	Refetch on every (re)connect: whatever happened while we were dark is now visible.
		Reload().catch( console.error )
	}
	source.onerror = () => {
		link.className = 'down'
		link.textContent = '切断 — 再接続中'
	}

	source.addEventListener( 'ticket'	, e => Replace( JSON.parse( e.data ) ) )
	source.addEventListener( 'kds'		, e => Replace( JSON.parse( e.data ) ) )
	source.addEventListener( 'order'	, () => Reload().catch( console.error ) )
}

Connect()
setInterval( Render, 10000 )	//	keep the waiting clocks honest
