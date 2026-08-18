package store.pos.handy

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.prefs by preferencesDataStore( "settings" )

data class Config(
	val baseUrl		: String = ""
,	val token		: String = ""
,	val terminal	: String = ""
) {
	val configured get() = baseUrl.isNotBlank() && terminal.isNotBlank()
}

class Settings( private val context: Context ) {

	private object Key {
		val base		= stringPreferencesKey( "base" )
		val token		= stringPreferencesKey( "token" )
		val terminal	= stringPreferencesKey( "terminal" )
	}

	val flow: Flow< Config > = context.prefs.data.map {
		Config( it[ Key.base ] ?: "", it[ Key.token ] ?: "", it[ Key.terminal ] ?: "" )
	}

	suspend fun save( config: Config ) {
		context.prefs.edit {
			it[ Key.base ]		= config.baseUrl.trim().trimEnd( '/' )
			it[ Key.token ]		= config.token.trim()
			it[ Key.terminal ]	= config.terminal.trim()
		}
	}
}
