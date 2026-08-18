package store.pos.handy

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

val JSON = Json { ignoreUnknownKeys = true; encodeDefaults = true }

//	A refusal the server means: the request was understood and rejected. Repeating it will not
//	help, so the outbox stops and shows it to a person instead of retrying into the void.
class Rejected( val status: Int, val detail: String ) : Exception( "$status $detail" )

class Api( private val config: () -> Config ) {

	private val client = OkHttpClient.Builder()
		.connectTimeout( 4, TimeUnit.SECONDS )
		.readTimeout( 10, TimeUnit.SECONDS )
		.retryOnConnectionFailure( true )
		.build()

	private fun request( path: String ): Request.Builder {
		val
		c = config()
		return Request.Builder()
			.url( "${ c.baseUrl }/pos/$path" )
			.apply { if ( c.token.isNotBlank() ) header( "X-POS-Token", c.token ) }
	}

	private suspend fun call( request: Request ): String = withContext( Dispatchers.IO ) {
		client.newCall( request ).execute().use { response ->
			val
			text = response.body?.string() ?: ""
			if ( response.code in 400..499 ) throw Rejected( response.code, text )
			if ( !response.isSuccessful ) throw java.io.IOException( "${ response.code } $text" )
			text
		}
	}

	suspend fun get( path: String ) = call( request( path ).get().build() )

	suspend fun post( path: String, body: String ) =
		call( request( path ).post( body.toRequestBody( "application/json".toMediaType() ) ).build() )
}
