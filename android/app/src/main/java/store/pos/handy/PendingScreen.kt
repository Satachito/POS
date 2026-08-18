package store.pos.handy

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

//	What has not reached the server yet, and what the server refused. The second kind is the
//	reason this screen exists: a refusal must end up in front of a person, not in a log.
@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun PendingScreen( repo: Repo, onBack: () -> Unit ) {

	val
	pending by repo.pending.collectAsState()
	val
	online by repo.online.collectAsState()
	val
	scope = rememberCoroutineScope()

	Scaffold(
		topBar = {
			TopAppBar(
				title			= { Text( "未送信 ${ pending.size }" ) }
			,	navigationIcon	= { TextButton( onBack ) { Text( "戻る" ) } }
			,	actions			= { if ( !online ) Text( "オフライン", color = Danger, modifier = Modifier.padding( end = 12.dp ) ) }
			)
		}
	) { padding ->
		if ( pending.isEmpty() ) Box( Modifier.padding( padding ).fillMaxSize(), Alignment.Center ) {
			Text( "すべて送信済みです", color = MaterialTheme.colorScheme.onSurfaceVariant )
		} else LazyColumn( Modifier.padding( padding ).fillMaxSize(), contentPadding = PaddingValues( 12.dp ) ) {
			items( pending, key = { it.id } ) { item ->
				Column( Modifier.fillMaxWidth().padding( vertical = 8.dp ) ) {
					Text( item.label, fontWeight = FontWeight.Medium )
					if ( item.error != null ) {
						Text( item.error, color = Danger, style = MaterialTheme.typography.bodySmall )
						Row( horizontalArrangement = Arrangement.spacedBy( 8.dp ) ) {
							TextButton( { scope.launch { repo.retry( item ) } } ) { Text( "再送" ) }
							TextButton( { scope.launch { repo.discard( item.id ) } } ) { Text( "破棄", color = Danger ) }
						}
					} else Text(
						if ( item.attempts > 0 ) "送信中… ${ item.attempts }回目" else "送信待ち"
					,	style	= MaterialTheme.typography.bodySmall
					,	color	= MaterialTheme.colorScheme.onSurfaceVariant
					)
					HorizontalDivider()
				}
			}
		}
	}
}
