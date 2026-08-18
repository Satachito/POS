package store.pos.handy

import android.content.Context
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.encodeToString
import java.util.UUID

//	Everything the screens read and every write they make. One instance per process.
class Repo( context: Context ) {

	private val db			= Db.get( context )
	private val settings	= Settings( context )
	private val scope		= CoroutineScope( SupervisorJob() + Dispatchers.Default )

	private var config = Config()
	private val api = Api { config }

	val configFlow	= settings.flow.onEach { config = it }.stateIn( scope, SharingStarted.Eagerly, Config() )
	val pending		= db.pending().observe().stateIn( scope, SharingStarted.Eagerly, emptyList() )

	private val _menu	= MutableStateFlow( Menu() )
	private val _tables	= MutableStateFlow< List< TableView > >( emptyList() )
	private val _online	= MutableStateFlow( false )
	private val _note	= MutableStateFlow< String? >( null )

	val menu	= _menu.asStateFlow()
	val tables	= _tables.asStateFlow()
	val online	= _online.asStateFlow()
	val note	= _note.asStateFlow()

	suspend fun save( config: Config ) = settings.save( config )

	fun say( text: String? ) { _note.value = text }

	init {
		scope.launch { restore() }
		scope.launch { sender() }
	}

	//	----------------------------------------------------------------- cache

	private suspend fun restore() {
		db.cache().get( "menu" )?.let { runCatching { _menu.value = JSON.decodeFromString< Menu >( it.json ) } }
		db.cache().get( "tables" )?.let { runCatching { _tables.value = JSON.decodeFromString( it.json ) } }
	}

	//	Menus are asked for by hash: an unchanged menu costs a few dozen bytes, so this can run
	//	on every refresh without thinking about it.
	suspend fun refresh() {
		if ( !config.configured ) return
		try {
			val
			text = api.get( "menu?v=${ _menu.value.version }" )
			val
			fetched = JSON.decodeFromString< Menu >( text )
			if ( fetched.version != _menu.value.version && fetched.items.isNotEmpty() ) {
				_menu.value = fetched
				db.cache().put( Cached( "menu", text ) )
			}

			val
			tables = api.get( "tables" )
			_tables.value = JSON.decodeFromString( tables )
			db.cache().put( Cached( "tables", tables ) )

			_online.value = true
		} catch ( e: Rejected ) {
			_online.value = true
			say( e.detail )
		} catch ( e: Exception ) {
			_online.value = false
		}
	}

	suspend fun order( orderId: String ): OrderView? = try {
		JSON.decodeFromString< OrderView >( api.get( "order/$orderId" ) ).also { _online.value = true }
	} catch ( e: Exception ) {
		_online.value = false
		null
	}

	//	----------------------------------------------------------------- writes

	private suspend fun enqueue( key: String, path: String, body: String, label: String ) {
		db.pending().add( Pending( key = key, path = path, body = body, label = label ) )
		wake.trySend( Unit )
	}

	suspend fun openTable( table: String, guests: Int ): String {
		val
		id = UUID.randomUUID().toString()
		enqueue(
			id
		,	"order"
		,	JSON.encodeToString( OpenRequest( id, table, guests, config.terminal ) )
		,	"$table 開卓 ${ guests }名"
		)
		return id
	}

	suspend fun send( orderId: String, table: String, lines: List< LineRequest >, summary: String ) {
		val
		id = UUID.randomUUID().toString()
		enqueue(
			id
		,	"ticket"
		,	JSON.encodeToString( TicketRequest( id, orderId, config.terminal, lines ) )
		,	"$table $summary"
		)
	}

	suspend fun voidLine( ticketId: String, line: Int, reason: String, label: String ) =
		enqueue(
			"void:$ticketId:$line"
		,	"ticket/$ticketId/void"
		,	JSON.encodeToString( VoidRequest( line, reason, config.terminal ) )
		,	"取消 $label"
		)

	suspend fun close( orderId: String, payments: List< Payment >, discount: Int, label: String ) =
		enqueue(
			"close:$orderId"
		,	"order/$orderId/close"
		,	JSON.encodeToString( CloseRequest( payments, discount, "", config.terminal ) )
		,	"会計 $label"
		)

	suspend fun discard( id: Long ) = db.pending().removeById( id )

	suspend fun retry( item: Pending ) {
		db.pending().update( item.copy( error = null, attempts = 0 ) )
		wake.trySend( Unit )
	}

	//	----------------------------------------------------------------- sender

	private val wake = kotlinx.coroutines.channels.Channel< Unit >( kotlinx.coroutines.channels.Channel.CONFLATED )

	//	Drains the outbox in order, forever. A network failure backs off and retries; a 4xx is
	//	the server saying no, so the row is parked with its reason and a person decides.
	private suspend fun sender() {
		var backoff = 1000L
		while ( true ) {
			val
			item = if ( config.configured ) db.pending().next() else null
			if ( item == null ) {
				withTimeoutOrNull( 5000 ) { wake.receive() }
				continue
			}
			try {
				api.post( item.path, item.body )
				db.pending().remove( item )
				_online.value = true
				backoff = 1000L
				refresh()
			} catch ( e: Rejected ) {
				db.pending().update( item.copy( error = e.detail.take( 300 ), attempts = item.attempts + 1 ) )
				say( "${ item.label }: サーバに拒否されました" )
			} catch ( e: Exception ) {
				db.pending().update( item.copy( attempts = item.attempts + 1 ) )
				_online.value = false
				delay( backoff )
				backoff = ( backoff * 2 ).coerceAtMost( 15000L )
			}
		}
	}

	//	Polling beats SSE here: three handies, a screen that is only up while somebody is
	//	holding it, and no reconnect logic to get wrong.
	fun startPolling() = scope.launch {
		while ( isActive ) {
			refresh()
			delay( 4000 )
		}
	}
}
