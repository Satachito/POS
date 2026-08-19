package store.pos.handy

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

//	The home screen. Everything the floor does starts by pointing at a table.
@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun TablesScreen(
	repo		: Repo
,	onOrder		: ( String, String ) -> Unit	//	table code, order id
,	onSettings	: () -> Unit
,	onPending	: () -> Unit
) {
	val
	tables by repo.tables.collectAsState()
	val
	online by repo.online.collectAsState()
	val
	pending by repo.pending.collectAsState()
	val
	scope = rememberCoroutineScope()

	var seating by remember { mutableStateOf< TableView? >( null ) }

	LaunchedEffect( Unit ) { repo.startPolling() }

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text( "卓一覧" ) }
			,	actions = {
					//	The two things worth interrupting for: nothing is reaching the server,
					//	or something is stuck. Both live in the corner, always visible.
					if ( !online ) AssistChip( onClick = {}, label = { Text( "オフライン" ) }, colors = AssistChipDefaults.assistChipColors( labelColor = Danger ) )
					if ( pending.isNotEmpty() ) TextButton( onPending ) {
						Text( "未送信 ${ pending.size }", color = if ( pending.any { it.error != null } ) Danger else Warn )
					}
					IconButton( onSettings ) { Text( "⚙" , fontSize = 20.sp ) }
				}
			)
		}
	) { padding ->
		//	Three across on a 360dp phone, which is what the floor actually carries -- the
		//	emulator's 411dp made 108dp look fine and it is not. Sixteen tables have to be
		//	readable in one glance, not eight rows of scrolling.
		LazyVerticalGrid(
			columns				= GridCells.Adaptive( 100.dp )
		,	modifier			= Modifier.padding( padding ).fillMaxSize()
		,	contentPadding		= PaddingValues( 10.dp )
		,	horizontalArrangement = Arrangement.spacedBy( 8.dp )
		,	verticalArrangement	= Arrangement.spacedBy( 8.dp )
		) {
			items( tables, key = { it.code } ) { table ->
				val
				open = table.openOrder
				Column(
					Modifier
						.height( 104.dp )
						.background( if ( open == null ) MaterialTheme.colorScheme.surface else Busy.copy( alpha = .10f ), RoundedCornerShape( 12.dp ) )
						.border( if ( open == null ) 1.dp else 2.dp, if ( open == null ) Line else Busy, RoundedCornerShape( 12.dp ) )
						.clickable { if ( open == null ) seating = table else onOrder( table.code, open.order_id ) }
						.padding( 8.dp )
				) {
					Text( table.code, fontWeight = FontWeight.Bold, fontSize = 24.sp )
					if ( open == null ) {
						Text( "${ table.seats }席", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant )
						Spacer( Modifier.weight( 1f ) )
						Text( "空", color = MaterialTheme.colorScheme.onSurfaceVariant )
					} else {
						//	Four lines is one too many for a card this size at three across, so the
						//	head count rides along with the elapsed time rather than the slip number.
						Text( open.number, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant )
						Spacer( Modifier.weight( 1f ) )
						Text( yen( open.total ), fontWeight = FontWeight.SemiBold, maxLines = 1 )
						Text( "${ open.guests }名・${ elapsedShort( open.opened_at ) }", style = MaterialTheme.typography.bodySmall, color = Busy, maxLines = 1 )
					}
				}
			}
		}
	}

	seating?.let { table ->
		var guests by remember( table.code ) { mutableStateOf( table.seats.coerceAtLeast( 1 ) ) }
		AlertDialog(
			onDismissRequest	= { seating = null }
		,	title				= { Text( "${ table.code } を開く" ) }
		,	text				= {
				Row( verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy( 16.dp ) ) {
					OutlinedButton( { if ( guests > 1 ) guests-- } ) { Text( "−", fontSize = 22.sp ) }
					Text( "${ guests }名", fontSize = 26.sp, fontWeight = FontWeight.Bold )
					OutlinedButton( { guests++ } ) { Text( "＋", fontSize = 22.sp ) }
				}
			}
		,	confirmButton		= {
				TextButton( {
					scope.launch {
						val
						id = repo.open( "", table.code, guests )
						seating = null
						onOrder( table.code, id )
					}
				} ) { Text( "開卓して注文へ" ) }
			}
		,	dismissButton		= { TextButton( { seating = null } ) { Text( "やめる" ) } }
		)
	}
}
