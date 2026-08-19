package store.pos.handy

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

//	Home screen for a store whose bills belong to people rather than seats.
//
//	A snack's regulars move along the counter, sit down next to somebody else's tab, and are
//	known by name long before they are known by where they sat -- so the list is of open
//	tabs, the name is the heading, and the seat is an optional note underneath.
@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun BillsScreen(
	repo		: Repo
,	onOrder		: ( String, String ) -> Unit	//	label, order id
,	onSettings	: () -> Unit
,	onPending	: () -> Unit
) {
	val
	bills by repo.bills.collectAsState()
	val
	tables by repo.tables.collectAsState()
	val
	online by repo.online.collectAsState()
	val
	pending by repo.pending.collectAsState()
	val
	scope = rememberCoroutineScope()

	var opening by remember { mutableStateOf( false ) }

	LaunchedEffect( Unit ) { repo.startPolling() }

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text( "伝票 ${ bills.size }" ) }
			,	actions = {
					if ( !online ) AssistChip( onClick = {}, label = { Text( "オフライン" ) }, colors = AssistChipDefaults.assistChipColors( labelColor = Danger ) )
					if ( pending.isNotEmpty() ) TextButton( onPending ) {
						Text( "未送信 ${ pending.size }", color = if ( pending.any { it.error != null } ) Danger else Warn )
					}
					IconButton( onSettings ) { Text( "⚙", fontSize = 20.sp ) }
				}
			)
		}
	,	bottomBar = {
			Surface( tonalElevation = 3.dp ) {
				Button(
					onClick		= { opening = true }
				,	modifier	= Modifier.fillMaxWidth().padding( 12.dp ).height( 54.dp )
				) { Text( "＋ 新しい伝票", fontSize = 18.sp ) }
			}
		}
	) { padding ->
		if ( bills.isEmpty() ) Box( Modifier.padding( padding ).fillMaxSize(), Alignment.Center ) {
			Text( "開いている伝票はありません", color = MaterialTheme.colorScheme.onSurfaceVariant )
		} else LazyColumn(
			modifier			= Modifier.padding( padding ).fillMaxSize()
		,	contentPadding		= PaddingValues( 10.dp )
		,	verticalArrangement	= Arrangement.spacedBy( 8.dp )
		) {
			items( bills, key = { it.order_id } ) { bill ->
				Row(
					Modifier
						.fillMaxWidth()
						.background( Busy.copy( alpha = .08f ), RoundedCornerShape( 12.dp ) )
						.border( 1.dp, Busy.copy( alpha = .5f ), RoundedCornerShape( 12.dp ) )
						.clickable { onOrder( bill.label, bill.order_id ) }
						.padding( 14.dp )
				,	verticalAlignment = Alignment.CenterVertically
				) {
					Column( Modifier.weight( 1f ) ) {
						Text( bill.label, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1 )
						Text(
							listOfNotNull( bill.table, "${ bill.guests }名", elapsed( bill.opened_at ), bill.number ).joinToString( "・" )
						,	style	= MaterialTheme.typography.bodySmall
						,	color	= MaterialTheme.colorScheme.onSurfaceVariant
						,	maxLines = 1
						)
					}
					Text( yen( bill.total ), fontSize = 18.sp, fontWeight = FontWeight.SemiBold )
				}
			}
		}
	}

	if ( opening ) {
		var name	by remember { mutableStateOf( "" ) }
		var guests	by remember { mutableStateOf( 1 ) }
		var seat	by remember { mutableStateOf< String? >( null ) }

		AlertDialog(
			onDismissRequest	= { opening = false }
		,	title				= { Text( "新しい伝票" ) }
		,	text				= {
				Column( verticalArrangement = Arrangement.spacedBy( 12.dp ) ) {
					//	The name is the first thing asked for and the only thing required:
					//	it is what the bill is called for the rest of the night.
					OutlinedTextField(
						name, { name = it }
					,	label		= { Text( "お名前" ) }
					,	singleLine	= true
					,	modifier	= Modifier.fillMaxWidth()
					)
					Row( verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy( 14.dp ) ) {
						OutlinedButton( { if ( guests > 1 ) guests-- } ) { Text( "−", fontSize = 20.sp ) }
						Text( "${ guests }名", fontSize = 20.sp, fontWeight = FontWeight.Bold )
						OutlinedButton( { guests++ } ) { Text( "＋", fontSize = 20.sp ) }
					}
					Text( "席（任意）", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant )
					Row( Modifier.horizontalScroll( rememberScrollState() ), horizontalArrangement = Arrangement.spacedBy( 6.dp ) ) {
						FilterChip( seat == null, { seat = null }, { Text( "なし" ) } )
						tables.forEach { t -> FilterChip( seat == t.code, { seat = t.code }, { Text( t.code ) } ) }
					}
				}
			}
		,	confirmButton = {
				TextButton(
					enabled	= name.isNotBlank()
				,	onClick	= {
						scope.launch {
							val
							id = repo.open( name.trim(), seat, guests )
							opening = false
							onOrder( name.trim(), id )
						}
					}
				) { Text( "開いて注文へ" ) }
			}
		,	dismissButton = { TextButton( { opening = false } ) { Text( "やめる" ) } }
		)
	}
}
