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

//	Minutes are what the floor thinks in, until they are not: a table left open overnight
//	reads as "1073分", which nobody parses at a glance. Past two hours, switch to hours.
fun elapsed( at: String ): String {
	val
	m = minutesSince( at )
	//	Past two hours the minutes stop carrying information and start costing width.
	return if ( m < 120 ) "${ m }分" else "${ m / 60 }時間"
}
