package store.pos.handy

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

//	Held in one hand, in a dim room, by someone who is also carrying plates. Large touch
//	targets, few colours, and colour reserved for state that matters: a table in use, an
//	order that has not reached the server yet.

val Ink		= Color( 0xFF15181E )
val Paper	= Color( 0xFFF7F8FA )
val Line	= Color( 0xFFDDE1E8 )
val Accent	= Color( 0xFF1D4ED8 )
val Busy	= Color( 0xFF0F766E )
val Warn	= Color( 0xFFB45309 )
val Danger	= Color( 0xFFB91C1C )

private val scheme = lightColorScheme(
	primary				= Accent
,	onPrimary			= Color.White
,	secondary			= Busy
,	background			= Paper
,	onBackground		= Ink
,	surface				= Color.White
,	onSurface			= Ink
,	surfaceVariant		= Color( 0xFFEDF0F5 )
,	onSurfaceVariant	= Color( 0xFF5A6373 )
,	error				= Danger
,	outline				= Line
)

@Composable
fun HandyTheme( content: @Composable () -> Unit ) = MaterialTheme( colorScheme = scheme, content = content )

fun yen( amount: Int ) = "¥%,d".format( amount )

//	Minutes since an ISO timestamp with offset, as the server writes them. Anything
//	unparseable reads as 0 rather than crashing a screen somebody is using mid-service.
fun minutesSince( at: String ): Int = runCatching {
	( ( System.currentTimeMillis() - java.time.OffsetDateTime.parse( at ).toInstant().toEpochMilli() ) / 60000 ).toInt()
}.getOrDefault( 0 )

//	How long they have been sitting. In a store that charges by the hour this is the billing
//	clock, not a curiosity: at 1時間52分 somebody should be asking about the extension, and
//	"2時間" -- which covers everything from 120 to 179 minutes -- loses exactly that. Minutes
//	are dropped only past a day, where a bill has plainly been left open overnight and the
//	number has stopped meaning anything anyway.
fun elapsed( at: String ): String {
	val
	m = minutesSince( at )
	return when {
		m < 60		-> "${ m }分"
		m < 24 * 60	-> "${ m / 60 }時間${ m % 60 }分"
		else		-> "${ m / 60 }時間"
	}
}

//	The table card has room for about six characters, so it trades the precision away. The
//	bill list, where the clock actually matters, uses the full form.
fun elapsedShort( at: String ): String {
	val
	m = minutesSince( at )
	return if ( m < 120 ) "${ m }分" else "${ m / 60 }時間"
}
