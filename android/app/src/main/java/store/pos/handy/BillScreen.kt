package store.pos.handy

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import kotlinx.coroutines.launch

private val METHODS = listOf( "cash" to "現金", "card" to "カード", "qr" to "QR" )

@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun BillScreen( repo: Repo, table: String, orderId: String, onBack: () -> Unit, onDone: () -> Unit ) {

	val
	scope = rememberCoroutineScope()
	var order		by remember { mutableStateOf< OrderView? >( null ) }
	var method		by remember { mutableStateOf( "cash" ) }
	var received	by remember { mutableStateOf( "" ) }
	var discount	by remember { mutableStateOf( "" ) }
	var voiding		by remember { mutableStateOf< Pair< Ticket, TicketLine >? >( null ) }

	//	The bill is always refetched, never carried over from the table list: settling against
	//	a stale total is the one mistake here that costs real money.
	suspend fun reload() { order = repo.order( orderId ) }
	LaunchedEffect( orderId ) { reload() }

	val
	off		= discount.toIntOrNull() ?: 0
	val
	total	= ( ( order?.bill?.subtotal ?: 0 ) - off ).coerceAtLeast( 0 )
	val
	paid	= received.toIntOrNull() ?: 0
	val
	change	= ( paid - total ).coerceAtLeast( 0 )

	Scaffold(
		topBar = {
			TopAppBar(
				title			= { Text( "$table 会計  ${ order?.number ?: "" }" ) }
			,	navigationIcon	= { TextButton( onBack ) { Text( "戻る" ) } }
			)
		}
	) { padding ->
		Column( Modifier.padding( padding ).fillMaxSize() ) {

			LazyColumn( Modifier.weight( 1f ), contentPadding = PaddingValues( 12.dp ) ) {
				order?.tickets?.forEach { ticket ->
					items( ticket.lines, key = { "${ ticket.ticket_id }-${ it.no }" } ) { line ->
						val
						dead = line.state == "void"
						Row(
							Modifier.fillMaxWidth().padding( vertical = 6.dp )
						,	verticalAlignment = Alignment.CenterVertically
						) {
							Text( "${ line.qty }", Modifier.width( 34.dp ), fontWeight = FontWeight.Bold )
							Column( Modifier.weight( 1f ) ) {
								Text(
									line.name + if ( line.options.isEmpty() ) "" else " (${ line.options.joinToString( "・" ) { it.name } })"
								,	textDecoration	= if ( dead ) TextDecoration.LineThrough else null
								,	color			= if ( dead ) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
								)
								if ( line.note.isNotBlank() ) Text( line.note, style = MaterialTheme.typography.bodySmall, color = Warn )
							}
							Text(
								yen( ( line.price + line.options.sumOf { it.price } ) * line.qty )
							,	textDecoration = if ( dead ) TextDecoration.LineThrough else null
							)
							if ( !dead ) TextButton( { voiding = ticket to line } ) { Text( "取消", color = Danger ) }
						}
						HorizontalDivider()
					}
				}
			}

			Surface( tonalElevation = 3.dp ) {
				Column( Modifier.padding( 14.dp ), verticalArrangement = Arrangement.spacedBy( 10.dp ) ) {

					Row( horizontalArrangement = Arrangement.spacedBy( 8.dp ), modifier = Modifier.horizontalScroll( rememberScrollState() ) ) {
						METHODS.forEach { ( code, label ) -> FilterChip( method == code, { method = code }, { Text( label ) } ) }
					}

					Row( horizontalArrangement = Arrangement.spacedBy( 10.dp ) ) {
						OutlinedTextField(
							discount, { discount = it.filter { c -> c.isDigit() } }
						,	label			= { Text( "割引" ) }
						,	singleLine		= true
						,	keyboardOptions	= KeyboardOptions( keyboardType = KeyboardType.Number )
						,	modifier		= Modifier.weight( 1f )
						)
						OutlinedTextField(
							received, { received = it.filter { c -> c.isDigit() } }
						,	label			= { Text( if ( method == "cash" ) "預り" else "受領" ) }
						,	singleLine		= true
						,	keyboardOptions	= KeyboardOptions( keyboardType = KeyboardType.Number )
						,	modifier		= Modifier.weight( 1f )
						)
					}

					Row {
						Text( "合計", Modifier.weight( 1f ), fontSize = 18.sp )
						Text( yen( total ), fontSize = 24.sp, fontWeight = FontWeight.Bold )
					}
					if ( method == "cash" && paid > 0 ) Row {
						Text( "釣銭", Modifier.weight( 1f ), color = MaterialTheme.colorScheme.onSurfaceVariant )
						Text( yen( change ), fontSize = 20.sp, color = Busy, fontWeight = FontWeight.SemiBold )
					}

					//	The server recomputes the total from the tickets and refuses a short
					//	payment, so this button is a convenience, not the authority.
					Button(
						enabled		= order != null && paid >= total && total >= 0
					,	modifier	= Modifier.fillMaxWidth().height( 54.dp )
					,	onClick		= {
							scope.launch {
								repo.close( orderId, listOf( Payment( method, paid ) ), off, "$table ${ order?.number ?: "" }" )
								repo.say( "$table 会計 ${ yen( total ) }" + if ( method == "cash" ) " / 釣銭 ${ yen( change ) }" else "" )
								onDone()
							}
						}
					) { Text( "会計する", fontSize = 18.sp ) }
				}
			}
		}
	}

	voiding?.let { ( ticket, line ) ->
		var reason by remember( line.no ) { mutableStateOf( "" ) }
		AlertDialog(
			onDismissRequest	= { voiding = null }
		,	title				= { Text( "${ line.name } を取消" ) }
		,	text				= {
				Column {
					Text( "取消は記録に残ります。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant )
					OutlinedTextField( reason, { reason = it }, label = { Text( "理由" ) }, singleLine = true )
				}
			}
		,	confirmButton = {
				TextButton( {
					scope.launch {
						repo.voidLine( ticket.ticket_id, line.no, reason, line.name )
						voiding = null
						reload()
					}
				} ) { Text( "取消する", color = Danger ) }
			}
		,	dismissButton = { TextButton( { voiding = null } ) { Text( "やめる" ) } }
		)
	}
}
