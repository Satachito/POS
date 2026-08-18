//	Menu admin, for the counter PC.
//
//	Writes go through JSONables' generic CRUD at /db/pos/, which mutates the very cluster
//	objects the POS API reads from -- so an edit is live for the handies immediately, with no
//	restart. What is not automatic is telling them: /pos/menu/publish broadcasts the new menu
//	hash after every write, so a sold-out item stops being sellable within the second rather
//	than at the next poll.

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

//	Stands in for JSONables' own jsonables/client.js. Same endpoints, but this one can carry
//	the admin token, so the page works from the counter PC and not only on the Pi itself.
class
Cluster {
	constructor( table )	{ this.base = `/db/pos/${ table }/` }
	URL( id )				{ return this.base + encodeURIComponent( id ) }
	async list()			{ return ( await Fetch( this.base ) ).json() }
	async post( record )	{ return ( await Fetch( this.base, { method: 'POST', body: JSON.stringify( record ) } ) ).json() }
	async put( id, record )	{ return Fetch( this.URL( id ), { method: 'PUT', body: JSON.stringify( record ) } ) }
	async del( id )			{ return Fetch( this.URL( id ), { method: 'DELETE' } ) }
}

const
clusters = {
	items		: new Cluster( 'items' )
,	categories	: new Cluster( 'categories' )
,	tables		: new Cluster( 'tables' )
}

const
state = { items: [], categories: [], tables: [] }	//	[ { id, record } ]

let
selected = null	//	item code, not internal id: ids are re-derived by compaction

//	----------------------------------------------------------------- helpers

const
$ = _ => document.getElementById( _ )

const
Esc = _ => String( _ ?? '' ).replace( /[&<>"]/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] )

const
ByOrder = ( a, b ) => ( a.order ?? 0 ) - ( b.order ?? 0 ) || String( a.code ).localeCompare( b.code )

const
Say = ( text, bad ) => {
	const
	el = $( 'status' )
	el.textContent	= text
	el.className	= bad ? 'err' : ''
	if ( !bad ) setTimeout( () => { if ( el.textContent === text ) el.textContent = '' }, 2500 )
}

const
Guard = fn => async ( ...args ) => {
	try { await fn( ...args ) } catch ( e ) { Say( e.message, true ); console.error( e ) }
}

//	Every write is followed by a reload and a publish: the page never shows its own optimistic
//	guess of what the server holds, and the floor hears about the change straight away.
const
Commit = async ( work, message ) => {
	await work()
	await Fetch( '/pos/menu/publish', { method: 'POST' } )
	await Load()
	Say( message )
}

const
Load = async () => {
	for ( const table in clusters ) state[ table ] = ( await clusters[ table ].list() ).map( ( [ id, record ] ) => ( { id, record } ) )
	const
	menu = await ( await Fetch( '/pos/menu' ) ).json()
	$( 'version' ).textContent = `menu ${ menu.version }`
	Render()
}

const
Find = code => state.items.find( _ => _.record.code === code )

//	----------------------------------------------------------------- items

const
RenderItems = () => {
	const
	onlySold	= $( 'onlysold' ).checked
,	groups		= state.categories.map( _ => _.record ).sort( ByOrder )
,	items		= state.items.map( _ => _.record ).filter( _ => !onlySold || _.sold_out )

	const
	Bucket = category => items.filter( _ => _.category === category ).sort( ByOrder )
,	Loose	= items.filter( _ => !groups.some( g => g.code === _.category ) ).sort( ByOrder )

	const
	Section = ( label, list ) => !list.length ? '' : `
		<h2 class="cat">${ Esc( label ) }</h2>
		${ list.map( _ => `
		<div class="row ${ _.sold_out ? 'sold' : '' }" data-code="${ Esc( _.code ) }" aria-selected="${ _.code === selected }">
			<span class="code">${ Esc( _.code ) }</span>
			<span class="name">${ Esc( _.name ) }</span>
			<span class="price">¥${ Number( _.price ).toLocaleString() }</span>
			<button class="soldbtn" data-sold="${ Esc( _.code ) }">${ _.sold_out ? '売切' : '販売中' }</button>
		</div>` ).join( '' ) }`

	const
	html = groups.map( g => Section( g.name, Bucket( g.code ) ) ).join( '' ) + Section( '未分類', Loose )
	$( 'itemlist' ).innerHTML = html || '<p class="empty">商品がありません</p>'

	RenderDetail()
}

const
OptionRow = ( o = {} ) => `
	<div class="optrow">
		<input name="ocode" placeholder="コード" value="${ Esc( o.code ) }">
		<input name="oname" placeholder="名称" value="${ Esc( o.name ) }">
		<input name="oprice" type="number" placeholder="増額" value="${ o.price ?? 0 }">
		<button type="button" class="rmopt">×</button>
	</div>`

const
RenderDetail = () => {
	const
	form = $( 'detail' )
	if ( selected === null ) { form.hidden = true; return }
	form.hidden = false

	const
	entry	= Find( selected )
,	isNew	= !entry
,	r		= entry?.record ?? { code: '', name: '', category: state.categories[ 0 ]?.record.code ?? '', price: 0, tax: 10, station: 'kitchen', sold_out: false, order: 0, options: [] }

	const
	Option = ( value, label, current ) => `<option value="${ Esc( value ) }" ${ String( current ) === String( value ) ? 'selected' : '' }>${ Esc( label ) }</option>`

	form.innerHTML = `
		<label>コード${ isNew ? '' : '（変更不可）' }
			<input name="code" value="${ Esc( r.code ) }" ${ isNew ? 'required' : 'readonly' }></label>
		<label>名称
			<input name="name" value="${ Esc( r.name ) }" required></label>
		<div class="pair">
			<label>カテゴリ
				<select name="category">${ state.categories.map( _ => _.record ).sort( ByOrder ).map( c => Option( c.code, c.name, r.category ) ).join( '' ) }</select></label>
			<label>表示順
				<input name="order" type="number" value="${ r.order ?? 0 }"></label>
		</div>
		<div class="pair">
			<label>価格（税込）
				<input name="price" type="number" min="0" value="${ r.price ?? 0 }" required></label>
			<label>税率
				<select name="tax">${ [ 10, 8 ].map( _ => Option( _, `${ _ }%`, r.tax ?? 10 ) ).join( '' ) }</select></label>
		</div>
		<div class="pair">
			<label>出力先
				<select name="station">${ Option( 'kitchen', '厨房', r.station ) }${ Option( 'bar', 'ドリンク', r.station ) }</select></label>
			<label>販売状態
				<select name="sold_out">${ Option( 'false', '販売中', !!r.sold_out ) }${ Option( 'true', '売切', !!r.sold_out ) }</select></label>
		</div>

		<h3>オプション</h3>
		<div class="rows" id="opts">${ ( r.options ?? [] ).map( OptionRow ).join( '' ) }</div>
		<button type="button" id="addopt">＋ オプション</button>

		<div class="actions">
			<button type="submit" class="save">${ isNew ? '追加' : '保存' }</button>
			${ isNew ? '' : '<button type="button" class="del">削除</button>' }
		</div>`
}

const
ReadForm = form => {
	const
	F		= name => form.querySelector( `[name="${ name }"]` ).value
,	options	= [ ...form.querySelectorAll( '.optrow' ) ]
	.map( row => ( {
		code	: row.querySelector( '[name="ocode"]' ).value.trim()
	,	name	: row.querySelector( '[name="oname"]' ).value.trim()
	,	price	: Number( row.querySelector( '[name="oprice"]' ).value ) || 0
	} ) )
	.filter( _ => _.code && _.name )

	return {
		code		: F( 'code' ).trim()
	,	category	: F( 'category' )
	,	name		: F( 'name' ).trim()
	,	price		: Number( F( 'price' ) ) || 0
	,	tax			: Number( F( 'tax' ) )
	,	station		: F( 'station' )
	,	sold_out	: F( 'sold_out' ) === 'true'
	,	order		: Number( F( 'order' ) ) || 0
	,	options
	}
}

$( 'itemlist' ).addEventListener( 'click', Guard( async e => {
	const
	sold = e.target.closest( '[data-sold]' )
	if ( sold ) {
		const
		entry = Find( sold.dataset.sold )
		return Commit(
			() => clusters.items.put( entry.id, { ...entry.record, sold_out: !entry.record.sold_out } )
		,	`${ entry.record.name } を${ entry.record.sold_out ? '販売中' : '売切' }にしました`
		)
	}
	const
	row = e.target.closest( '[data-code]' )
	if ( !row ) return
	selected = row.dataset.code
	RenderItems()
} ) )

$( 'detail' ).addEventListener( 'click', Guard( async e => {
	if ( e.target.id === 'addopt' )				$( 'opts' ).insertAdjacentHTML( 'beforeend', OptionRow() )
	if ( e.target.classList.contains( 'rmopt' ) )	e.target.closest( '.optrow' ).remove()
	if ( e.target.classList.contains( 'del' ) ) {
		const
		entry = Find( selected )
		if ( !confirm( `${ entry.record.name } を削除します。過去の伝票は商品名と価格を写し取っているため影響しません。` ) ) return
		await Commit( () => clusters.items.del( entry.id ), '削除しました' )
		selected = null
		RenderItems()
	}
} ) )

$( 'detail' ).addEventListener( 'submit', Guard( async e => {
	e.preventDefault()
	const
	record	= ReadForm( e.target )
,	entry	= Find( selected )

	if ( !entry && Find( record.code ) ) throw new Error( `コード ${ record.code } は既に使われています` )

	await Commit(
		() => entry ? clusters.items.put( entry.id, record ) : clusters.items.post( record )
	,	entry ? '保存しました' : '追加しました'
	)
	selected = record.code
	RenderItems()
} ) )

$( 'new' ).addEventListener( 'click', () => { selected = ''; RenderItems() } )
$( 'onlysold' ).addEventListener( 'change', RenderItems )

//	----------------------------------------------------------------- categories / tables

//	Both are flat records edited a few times a year, so they get one plain grid rather than a
//	form: type into the cells, press 保存, and only the changed rows are written back.
const
COLUMNS = {
	categories	: [ [ 'code', 'コード' ], [ 'name', '名称' ], [ 'order', '表示順', 'number' ] ]
,	tables		: [ [ 'code', 'コード' ], [ 'name', '名称' ], [ 'seats', '席数', 'number' ], [ 'area', 'エリア' ], [ 'order', '表示順', 'number' ] ]
}

const
RenderGrid = table => {
	const
	columns	= COLUMNS[ table ]
,	rows	= [ ...state[ table ] ].sort( ( a, b ) => ByOrder( a.record, b.record ) )

	$( table ).innerHTML = `
		<div class="simple">
			<table>
				<thead><tr>${ columns.map( _ => `<th>${ _[ 1 ] }</th>` ).join( '' ) }<th></th></tr></thead>
				<tbody>${ rows.map( ( { id, record } ) => `
					<tr data-id="${ Esc( id ) }">
						${ columns.map( ( [ key, , type ] ) => `<td><input name="${ key }" type="${ type ?? 'text' }" value="${ Esc( record[ key ] ) }"></td>` ).join( '' ) }
						<td><button type="button" class="del" data-del="${ Esc( id ) }">削除</button></td>
					</tr>` ).join( '' ) }</tbody>
			</table>
			<div class="actions">
				<button type="button" data-add="${ table }">＋ 行を追加</button>
				<button type="button" class="save" data-save="${ table }">保存</button>
			</div>
		</div>`
}

const
GridRecord = ( tr, table ) => Object.fromEntries( COLUMNS[ table ].map( ( [ key, , type ] ) => {
	const
	value = tr.querySelector( `[name="${ key }"]` ).value
	return [ key, type === 'number' ? Number( value ) || 0 : value.trim() ]
} ) )

for ( const table of [ 'categories', 'tables' ] ) $( table ).addEventListener( 'click', Guard( async e => {
	if ( e.target.dataset.add === table ) {
		const
		blank = Object.fromEntries( COLUMNS[ table ].map( ( [ key, , type ] ) => [ key, type === 'number' ? 0 : '' ] ) )
		state[ table ].push( { id: null, record: blank } )
		return RenderGrid( table )
	}
	if ( e.target.dataset.del ) {
		if ( !confirm( '削除します' ) ) return
		return Commit( () => clusters[ table ].del( e.target.dataset.del ), '削除しました' )
	}
	if ( e.target.dataset.save === table ) {
		const
		writes = []
		for ( const tr of $( table ).querySelectorAll( 'tbody tr' ) ) {
			const
			record	= GridRecord( tr, table )
		,	id		= tr.dataset.id
			if ( !record.code ) continue
			const
			before = state[ table ].find( _ => _.id === id )?.record
			if ( !before ) writes.push( () => clusters[ table ].post( record ) )
			else if ( JSON.stringify( before ) !== JSON.stringify( { ...before, ...record } ) ) writes.push( () => clusters[ table ].put( id, { ...before, ...record } ) )
		}
		if ( !writes.length ) return Say( '変更はありません' )
		return Commit( async () => { for ( const w of writes ) await w() }, `${ writes.length }件保存しました` )
	}
} ) )

//	----------------------------------------------------------------- tabs

const
Render = () => {
	RenderItems()
	RenderGrid( 'categories' )
	RenderGrid( 'tables' )
}

$( 'tabs' ).addEventListener( 'click', e => {
	const
	b = e.target.closest( '[data-tab]' )
	if ( !b ) return
	for ( const _ of $( 'tabs' ).children ) _.setAttribute( 'aria-pressed', _ === b )
	for ( const _ of document.querySelectorAll( '.tab' ) ) _.hidden = _.id !== b.dataset.tab
} )

//	Sold out can be flipped from a handy on the floor as well as from here, so the counter
//	follows the same broadcast the terminals do rather than showing a stale list.
new EventSource( Auth( '/pos/events' ) ).addEventListener( 'menu', () => Guard( Load )() )

Guard( Load )()
