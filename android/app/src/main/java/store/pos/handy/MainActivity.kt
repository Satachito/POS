package store.pos.handy

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

class MainActivity : ComponentActivity() {

	override fun onCreate( savedInstanceState: Bundle? ) {
		super.onCreate( savedInstanceState )

		//	A handy is held, not pocketed: the screen going dark between taking one table's
		//	order and the next is a wake-and-unlock in the middle of service. The manifest has
		//	no attribute for this -- android:keepScreenOn on <activity> is silently ignored --
		//	so it has to be a window flag.
		window.addFlags( WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON )

		val
		repo = ( application as App ).repo

		setContent {
			HandyTheme {
				val
				nav = rememberNavController()
				val
				config by repo.configFlow.collectAsState()
				val
				note by repo.note.collectAsState()
				val
				snackbar = remember { SnackbarHostState() }

				LaunchedEffect( note ) {
					note?.let { snackbar.showSnackbar( it ); repo.say( null ) }
				}

				//	targetSdk 36 forces edge to edge, which retires windowSoftInputMode=adjustResize:
				//	nothing moves for the keyboard unless the app says so. Without imePadding the
				//	numeric pad sits straight over the settle button, which is the one screen where
				//	somebody is holding cash and waiting.
				//
				//	The insets are consumed once, here: each screen's own Scaffold applies the system
				//	bars, so this outer one must not apply them a second time.
				Scaffold(
					snackbarHost		= { SnackbarHost( snackbar ) }
				,	contentWindowInsets	= WindowInsets( 0, 0, 0, 0 )
				) { _ ->
				  Box( Modifier.fillMaxSize().imePadding() ) {
					NavHost( nav, startDestination = if ( config.configured ) "tables" else "settings" ) {

						composable( "settings" ) {
							SettingsScreen( repo ) { nav.navigate( "tables" ) { popUpTo( 0 ) } }
						}

						composable( "tables" ) {
							TablesScreen(
								repo
							,	onOrder		= { table, orderId -> nav.navigate( "order/$table/$orderId" ) }
							,	onSettings	= { nav.navigate( "settings" ) }
							,	onPending	= { nav.navigate( "pending" ) }
							)
						}

						composable( "order/{table}/{orderId}" ) { entry ->
							val
							table	= entry.arguments?.getString( "table" ) ?: ""
							val
							orderId	= entry.arguments?.getString( "orderId" ) ?: ""
							OrderScreen(
								repo, table, orderId
							,	onBack	= { nav.popBackStack() }
							,	onBill	= { nav.navigate( "bill/$table/$orderId" ) }
							)
						}

						composable( "bill/{table}/{orderId}" ) { entry ->
							val
							table	= entry.arguments?.getString( "table" ) ?: ""
							val
							orderId	= entry.arguments?.getString( "orderId" ) ?: ""
							BillScreen(
								repo, table, orderId
							,	onBack	= { nav.popBackStack() }
							,	onDone	= { nav.navigate( "tables" ) { popUpTo( "tables" ) { inclusive = true } } }
							)
						}

						composable( "pending" ) { PendingScreen( repo ) { nav.popBackStack() } }
					}
				  }
				}
			}
		}
	}
}
