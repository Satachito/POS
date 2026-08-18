package store.pos.handy

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

//	One line in the cart, before it becomes a ticket.
data class CartLine(
	val item	: MenuItem
,	var qty		: Int
,	val options	: List< ItemOption >
,	val note	: String
) {
	val amount get() = ( item.price + options.sumOf { it.price } ) * qty
	val label get() = item.name + if ( options.isEmpty() ) "" else " (${ options.joinToString( "・" ) { it.name } })"
}

@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun OrderScreen(
	repo	: Repo
,	table	: String
,	orderId	: String
,	onBack	: () -> Unit
,	onBill	: () -> Unit
) {
	val
	menu by repo.menu.collectAsState()
	val
	pending by repo.pending.collectAsState()
	val
	scope = rememberCoroutineScope()

	val cart = remember { mutableStateListOf< CartLine >() }
	var category by remember { mutableStateOf( "" ) }
	var choosing by remember { mutableStateOf< MenuItem? >( null ) }
	var showCart by remember { mutableStateOf( false ) }

	LaunchedEffect( menu.version ) { if ( category.isBlank() ) category = menu.categories.firstOrNull()?.code ?: "" }

	val
	items = menu.items.filter { it.category == category }
	val
	total = cart.sumOf { it.amount }

	Scaffold(
		topBar = {
			TopAppBar(
				title			= { Text( table, fontWeight = FontWeight.Bold ) }
			,	navigationIcon	= { TextButton( onBack ) { Text( "戻る" ) } }
			,	actions			= {
					if ( pending.isNotEmpty() ) Text( "未送信 ${ pending.size }", color = Warn, modifier = Modifier.padding( end = 8.dp ) )
					TextButton( onBill ) { Text( "会計" ) }
				}
			)
		}
	,	bottomBar = {
			//	The cart never leaves the screen: how much is about to be sent, and one button
			//	to send it. Tapping the total opens the detail.
			Surface( tonalElevation = 3.dp ) {
				Row(
					Modifier.fillMaxWidth().padding( 12.dp )
				,	verticalAlignment		= Alignment.CenterVertically
				,	horizontalArrangement	= Arrangement.spacedBy( 12.dp )
				) {
					Column( Modifier.weight( 1f ).clickable( enabled = cart.isNotEmpty() ) { showCart = true } ) {
						Text( "${ cart.sumOf { it.qty } }点", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant )
						Text( yen( total ), fontSize = 22.sp, fontWeight = FontWeight.Bold )
					}
					Button(
						enabled		= cart.isNotEmpty()
					,	modifier	= Modifier.height( 52.dp ).widthIn( min = 140.dp )
					,	onClick		= {
							val
							lines = cart.map { LineRequest( it.item.code, it.qty, it.options.map { o -> o.code }, it.note ) }
							val
							summary = cart.joinToString( "・" ) { "${ it.item.name }×${ it.qty }" }.take( 60 )
							scope.launch {
								//	Saved locally and gone from the screen before the network is
								//	consulted: the floor keeps moving whatever the Wi-Fi does.
								repo.send( orderId, table, lines, summary )
								cart.clear()
								repo.say( "$table に送信しました" )
							}
						}
					) { Text( "送信", fontSize = 18.sp ) }
				}
			}
		}
	) { padding ->
		Column( Modifier.padding( padding ).fillMaxSize() ) {

			Row(
				Modifier.horizontalScroll( rememberScrollState() ).padding( horizontal = 10.dp, vertical = 6.dp )
			,	horizontalArrangement = Arrangement.spacedBy( 8.dp )
			) {
				menu.categories.forEach { c ->
					FilterChip( c.code == category, { category = c.code }, { Text( c.name ) } )
				}
			}

			LazyVerticalGrid(
				columns					= GridCells.Adaptive( 132.dp )
			,	modifier				= Modifier.fillMaxSize()
			,	contentPadding			= PaddingValues( 10.dp )
			,	horizontalArrangement	= Arrangement.spacedBy( 8.dp )
			,	verticalArrangement		= Arrangement.spacedBy( 8.dp )
			) {
				items( items, key = { it.code } ) { item ->
					Column(
						Modifier
							.height( 82.dp )
							.background( MaterialTheme.colorScheme.surface, RoundedCornerShape( 10.dp ) )
							.border( 1.dp, if ( item.sold_out ) Danger.copy( alpha = .4f ) else Line, RoundedCornerShape( 10.dp ) )
							.clickable( enabled = !item.sold_out ) {
								if ( item.options.isEmpty() ) Add( cart, item, emptyList(), "" ) else choosing = item
							}
							.padding( 10.dp )
					) {
						Text(
							item.name
						,	fontWeight		= FontWeight.Medium
						,	maxLines		= 2
						,	textDecoration	= if ( item.sold_out ) TextDecoration.LineThrough else null
						,	color			= if ( item.sold_out ) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
						)
						Spacer( Modifier.weight( 1f ) )
						Text( if ( item.sold_out ) "売切" else yen( item.price ), color = if ( item.sold_out ) Danger else MaterialTheme.colorScheme.onSurfaceVariant )
					}
				}
			}
		}
	}

	choosing?.let { item -> OptionDialog( item, { choosing = null } ) { options, note -> Add( cart, item, options, note ); choosing = null } }

	if ( showCart ) CartDialog( cart ) { showCart = false }
}

//	Same item with the same options and note collapses into one line, the way a person
//	would write it on a pad.
private fun Add( cart: MutableList< CartLine >, item: MenuItem, options: List< ItemOption >, note: String ) {
	val
	index = cart.indexOfFirst { it.item.code == item.code && it.options.map { o -> o.code } == options.map { o -> o.code } && it.note == note }
	if ( index >= 0 ) cart[ index ] = cart[ index ].copy( qty = cart[ index ].qty + 1 )
	else cart.add( CartLine( item, 1, options, note ) )
}

@Composable
private fun OptionDialog( item: MenuItem, onDismiss: () -> Unit, onAdd: ( List< ItemOption >, String ) -> Unit ) {
	val picked = remember { mutableStateListOf< ItemOption >() }
	var note by remember { mutableStateOf( "" ) }

	AlertDialog(
		onDismissRequest	= onDismiss
	,	title				= { Text( item.name ) }
	,	text				= {
			Column( verticalArrangement = Arrangement.spacedBy( 8.dp ) ) {
				item.options.forEach { option ->
					Row( verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable {
						if ( picked.any { it.code == option.code } ) picked.removeAll { it.code == option.code } else picked.add( option )
					} ) {
						Checkbox( picked.any { it.code == option.code }, null )
						Text( option.name, Modifier.weight( 1f ) )
						if ( option.price != 0 ) Text( "+${ yen( option.price ) }", color = MaterialTheme.colorScheme.onSurfaceVariant )
					}
				}
				OutlinedTextField( note, { note = it }, label = { Text( "備考" ) }, singleLine = true, modifier = Modifier.fillMaxWidth() )
			}
		}
	,	confirmButton	= { TextButton( { onAdd( picked.toList(), note ) } ) { Text( "追加" ) } }
	,	dismissButton	= { TextButton( onDismiss ) { Text( "やめる" ) } }
	)
}

@Composable
private fun CartDialog( cart: MutableList< CartLine >, onDismiss: () -> Unit ) = AlertDialog(
	onDismissRequest	= onDismiss
,	title				= { Text( "送信前の確認" ) }
,	text				= {
		LazyColumn( verticalArrangement = Arrangement.spacedBy( 4.dp ) ) {
			items( cart.toList() ) { line ->
				Row( verticalAlignment = Alignment.CenterVertically ) {
					Text( line.label, Modifier.weight( 1f ) )
					OutlinedButton( { val i = cart.indexOf( line ); if ( i >= 0 ) { if ( line.qty > 1 ) cart[ i ] = line.copy( qty = line.qty - 1 ) else cart.removeAt( i ) } } ) { Text( "−" ) }
					Text( "${ line.qty }", Modifier.padding( horizontal = 10.dp ), fontWeight = FontWeight.Bold )
					OutlinedButton( { val i = cart.indexOf( line ); if ( i >= 0 ) cart[ i ] = line.copy( qty = line.qty + 1 ) } ) { Text( "＋" ) }
				}
			}
		}
	}
,	confirmButton = { TextButton( onDismiss ) { Text( "閉じる" ) } }
)
