package store.pos.handy

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn( ExperimentalMaterial3Api::class )
@Composable
fun SettingsScreen( repo: Repo, onDone: () -> Unit ) {

	val
	current by repo.configFlow.collectAsState()
	val
	scope = rememberCoroutineScope()

	var base		by remember( current.baseUrl )	{ mutableStateOf( current.baseUrl.ifBlank { "http://pos.local:8080" } ) }
	var token		by remember( current.token )		{ mutableStateOf( current.token ) }
	var terminal	by remember( current.terminal )	{ mutableStateOf( current.terminal.ifBlank { "T1" } ) }
	var checking	by remember { mutableStateOf( false ) }
	var result		by remember { mutableStateOf< String? >( null ) }

	Scaffold( topBar = { TopAppBar( title = { Text( "設定" ) } ) } ) { padding ->
		Column(
			Modifier.padding( padding ).padding( 16.dp ).verticalScroll( rememberScrollState() )
		,	verticalArrangement = Arrangement.spacedBy( 12.dp )
		) {
			OutlinedTextField( base, { base = it }, label = { Text( "サーバ" ) }, singleLine = true, modifier = Modifier.fillMaxWidth() )
			OutlinedTextField( token, { token = it }, label = { Text( "トークン (POS_TOKEN)" ) }, singleLine = true, modifier = Modifier.fillMaxWidth() )
			OutlinedTextField( terminal, { terminal = it }, label = { Text( "端末名" ) }, singleLine = true, modifier = Modifier.fillMaxWidth() )

			Text(
				"端末名は伝票と取消の記録に残ります。3台なら T1 / T2 / T3。"
			,	style = MaterialTheme.typography.bodySmall
			,	color = MaterialTheme.colorScheme.onSurfaceVariant
			)

			Button(
				enabled = !checking
			,	modifier = Modifier.fillMaxWidth().height( 52.dp )
			,	onClick = {
					checking = true
					result = null
					scope.launch {
						repo.save( Config( base, token, terminal ) )
						repo.refresh()
						result = if ( repo.online.value ) "接続できました" else "つながりません。サーバとトークンを確認してください"
						checking = false
						if ( repo.online.value ) onDone()
					}
				}
			) { Text( if ( checking ) "確認中…" else "保存して接続" ) }

			result?.let {
				Text( it, Modifier.fillMaxWidth(), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant )
			}
		}
	}
}
