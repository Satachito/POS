//	Settling from the counter.
//
//	The same API the handy uses, so the two never disagree about a total: the bill is always
//	refetched before it is shown, and the server recomputes it from the tickets when it is
//	closed. This page only ever displays and asks.

const
TOKEN = new URLSearchParams( location.search ).get( 'token' )

const
Auth = url => TOKEN ? `${ url }${ url.includes( '?' ) ? '&' : '?' }token=${ encodeURIComponent( TOKEN ) }` : url

const
Fetch = async ( url, init ) => {
	const
	$ = await fetch( Auth( url ), init )
	if ( !$.ok ) throw new Error( `${ $.status } ${ ( await $.text() ).slice( 0, 200 ) }` )
	return $
}

const
GET		= async path => ( await Fetch( `/pos/${ path }` ) ).json()
const
POST	= async ( path, body ) => ( await Fetch( `/pos/${ path }`, { method: 'POST', body: JSON.stringify( body ?? {} ) } ) ).json()

const
$ = _ => document.getElementById( _ )

const
Esc = _ => String( _ ?? '' ).replace( /[&<>"]/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] )

const
yen = _ => `¥${ Number( _ ?? 0 ).toLocaleString() }`

const
Today = () => new Date().toLocaleDateString( 'sv-SE' )	//	YYYY-MM-DD, local

//	Whatever a person would call this bill: a name in a snack, a seat in an izakaya.
const
Label = _ => _.customer || _.table || _.number

const
Elapsed = at => {
	const
	m = Math.max( 0, Math.floor( ( Date.now() - new Date( at ) ) / 60000 ) )
	return m < 60 ? `${ m }分` : `${ Math.floor( m / 60 ) }時間${ m % 60 }分`
}

let
bills		= []
,	selected	= null	//	order_id
,	detail		= null	//	the refetched order
,	discount	= 0
,	tendered	= 0

//	----------------------------------------------------------------- render

const
RenderBills = () => {
	$( 'count' ).textContent = bills.length ? `${ bills.length }件` : ''
	$( 'bills' ).innerHTML = bills.length ? bills.map( _ => `
		<div class="bill" data-id="${ Esc( _.order_id ) }" aria-selected="${ _.order_id === selected }">
			<div>
				<div class="who">${ Esc( Label( _ ) ) }</div>
				<div class="meta">${ [ _.table, `${ _.guests }名`, Elapsed( _.opened_at ), _.number ].filter( Boolean ).map( Esc ).join( '・' ) }</div>
			</div>
			<div class="amount">${ yen( _.total ) }</div>
		</div>` ).join( '' ) : '<p class="empty">開いている伝票はありません</p>'
}

const
Amount = l => ( l.price + l.options.reduce( ( n, o ) => n + o.price, 0 ) ) * l.qty

//	Mirrors the server's Bill(): tax per rate on the base after the discount has been
//	apportioned across the rates it covers. Shown so the counter can read the figures before
//	committing -- the server computes its own and never trusts these.
const
Totals = () => {
	const
	live = detail.tickets.flatMap( t => t.lines ).filter( l => l.state !== 'void' )
	,	subtotal = live.reduce( ( n, l ) => n + Amount( l ), 0 )
	,	off = Math.max( 0, Math.min( discount, subtotal ) )

	const
	perRate = new Map()
	for ( const l of live ) perRate.set( l.tax, ( perRate.get( l.tax ) ?? 0 ) + Amount( l ) )

	return {
		total	: subtotal - off
	,	tax		: [ ...perRate ]
		.map( ( [ rate, sub ] ) => [ rate, subtotal ? sub - Math.round( off * sub / subtotal ) : 0 ] )
		.sort( ( a, b ) => b[ 0 ] - a[ 0 ] )
		.map( ( [ rate, base ] ) => `${ rate }% 内税 ${ yen( Math.round( base * rate / ( 100 + rate ) ) ) }` )
		.join( '　' )
	}
}

//	The notes a customer actually hands over for this total.
const
Notes = total => [ total, ...[ 1000, 5000, 10000 ].map( step => Math.ceil( total / step ) * step ) ]
.filter( ( _, i, all ) => _ > 0 && all.indexOf( _ ) === i )
.sort( ( a, b ) => a - b )
.slice( 0, 4 )

const
NoteButtons = total => Notes( total ).map( _ => `<button data-note="${ _ }">${ _ === total ? 'ちょうど' : yen( _ ) }</button>` ).join( '' )

const
ChangeLine = total => tendered >= total && tendered > 0
?	`<span class="grow">釣銭</span><span class="amount">${ yen( tendered - total ) }</span>`
:	''

const
RenderDetail = () => {
	const
	el = $( 'detail' )
	if ( !detail ) { el.innerHTML = '<p class="empty">左から伝票を選んでください</p>'; return }

	const
	rows = detail.tickets.flatMap( t => t.lines.map( l => ( { t, l } ) ) )
	,	{ total, tax } = Totals()

	el.innerHTML = `
		<h2>${ Esc( Label( detail ) ) }</h2>
		<div class="meta">${ [ detail.table, `${ detail.guests }名`, Elapsed( detail.opened_at ), detail.number ].filter( Boolean ).map( Esc ).join( '・' ) }</div>
		<table><tbody>${ rows.map( ( { t, l } ) => `
			<tr class="${ l.state === 'void' ? 'void' : '' }">
				<td class="qty">${ l.qty }</td>
				<td>${ Esc( l.name ) }
					${ l.options.map( o => `<span class="opt">${ Esc( o.name ) }</span>` ).join( ' ' ) }
					${ l.note ? `<div class="note">${ Esc( l.note ) }</div>` : '' }</td>
				<td class="amt">${ yen( Amount( l ) ) }</td>
				<td class="act">${ l.state === 'void' ? '' : `<button class="void" data-void="${ Esc( t.ticket_id ) }" data-line="${ l.no }">取消</button>` }</td>
			</tr>` ).join( '' ) }</tbody></table>

		<div class="foot">
			<div class="row">
				<span class="grow">割引</span>
				<input type="number" id="discount" min="0" step="100" value="${ discount || '' }" placeholder="0">
			</div>
			<div class="row">
				<span class="grow">預り</span>
				<input type="number" id="tendered" min="0" step="1000" value="${ tendered || '' }" placeholder="0">
			</div>
			<div class="notes" id="notes">${ NoteButtons( total ) }</div>
			<div class="row">
				<span class="grow">合計</span>
				<span class="total">${ yen( total ) }</span>
			</div>
			<div class="row change" id="change">${ ChangeLine( total ) }</div>
			<div class="tax">${ tax }</div>
			<button class="settle" id="settle">会計する</button>
		</div>`
}

//	----------------------------------------------------------------- data

const
Reload = async () => {
	bills = await GET( 'orders' )
	RenderBills()

	const
	sales = await GET( `sales/${ Today() }` )
	$( 'today' ).innerHTML = `本日 <b>${ sales.orders }</b>件　<b>${ yen( sales.total ) }</b>`
		+ ( sales.guests ? `　客単価 <b>${ yen( sales.per_guest ) }</b>` : '' )

	//	A selected bill that somebody else settled first should not linger on screen.
	if ( selected && !bills.some( _ => _.order_id === selected ) ) { selected = null; detail = null; RenderDetail() }
	else if ( selected ) await Open( selected, false )
}

const
Open = async ( orderId, reset = true ) => {
	selected = orderId
	if ( reset ) { discount = 0; tendered = 0 }
	detail = await GET( `order/${ orderId }` )
	RenderBills()
	RenderDetail()
}

//	----------------------------------------------------------------- events

$( 'bills' ).addEventListener( 'click', async e => {
	const
	row = e.target.closest( '[data-id]' )
	if ( row ) await Open( row.dataset.id ).catch( Report )
} )

$( 'detail' ).addEventListener( 'click', async e => {
	const
	v = e.target.closest( '[data-void]' )
	if ( v ) {
		const
		reason = prompt( '取消の理由' )
		if ( reason === null ) return
		try {
			await POST( `ticket/${ v.dataset.void }/void`, { line: Number( v.dataset.line ), reason, terminal: 'REGISTER' } )
			await Open( selected, false )
			await Reload()
		} catch ( err ) { Report( err ) }
		return
	}
	const
	note = e.target.closest( '[data-note]' )
	if ( note ) {
		tendered = Number( note.dataset.note )
		$( 'tendered' ).value = tendered
		Repaint()
		return
	}
	if ( e.target.id === 'settle' ) {
		if ( !confirm( `${ Label( detail ) } を会計します` ) ) return
		try {
			await POST( `order/${ selected }/close`, { discount, tendered, terminal: 'REGISTER' } )
			selected = null
			detail = null
			discount = 0
			tendered = 0
			RenderDetail()
			await Reload()
		} catch ( err ) { Report( err ) }
	}
} )

//	Redrawing would take the focus out of the field mid-keystroke, so the figures that move
//	are patched in place. All of them: a tax line that lags the discount is a wrong number
//	sitting under a right one.
const
Repaint = () => {
	if ( !detail ) return
	const
	{ total, tax } = Totals()
	$( 'detail' ).querySelector( '.total' ).textContent	= yen( total )
	$( 'detail' ).querySelector( '.tax' ).textContent	= tax
	$( 'change' ).innerHTML								= ChangeLine( total )
	$( 'notes' ).innerHTML								= NoteButtons( total )
}

$( 'detail' ).addEventListener( 'input', e => {
	if ( !detail ) return
	if ( e.target.id === 'discount' )		discount = Number( e.target.value ) || 0
	else if ( e.target.id === 'tendered' )	tendered = Number( e.target.value ) || 0
	else return
	Repaint()
} )

const
Report = e => { console.error( e ); alert( e.message ) }

//	----------------------------------------------------------------- live

const
Connect = () => {
	const
	source = new EventSource( Auth( '/pos/events' ) )

	source.onopen = () => {
		$( 'link' ).className = ''
		$( 'link' ).textContent = '接続'
		Reload().catch( Report )
	}
	source.onerror = () => {
		$( 'link' ).className = 'down'
		$( 'link' ).textContent = '切断 — 再接続中'
	}
	for ( const event of [ 'order', 'ticket', 'kds' ] ) source.addEventListener( event, () => Reload().catch( Report ) )
}

GET( 'menu' ).then( _ => { if ( _.store?.name ) $( 'store' ).textContent = `${ _.store.name }　会計` } ).catch( () => {} )
Connect()
setInterval( RenderBills, 30000 )	//	経過時間を進める
