package store.pos.handy

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

//	The outbox is the point of the whole app: pressing 送信 writes here and returns, and the
//	network is somebody else's problem. FIFO by id, so an order is opened before the tickets
//	that belong to it, and every row carries the idempotency key the server dedupes on.
@Entity( tableName = "outbox", indices = [ Index( value = [ "key" ], unique = true ) ] )
data class Pending(
	@PrimaryKey( autoGenerate = true ) val id: Long = 0
,	val key			: String
,	val path		: String
,	val body		: String
,	val label		: String
,	val createdAt	: Long = System.currentTimeMillis()
,	val attempts	: Int = 0
,	val error		: String? = null	//	set = refused by the server, waiting for a person
)

@Entity( tableName = "cache" )
data class Cached( @PrimaryKey val key: String, val json: String, val at: Long = System.currentTimeMillis() )

@Dao
interface PendingDao {

	@Insert( onConflict = OnConflictStrategy.IGNORE )
	suspend fun add( item: Pending ): Long

	//	Rows with an error are skipped, not dropped: the queue keeps moving while the refused
	//	one waits to be looked at.
	@Query( "SELECT * FROM outbox WHERE error IS NULL ORDER BY id LIMIT 1" )
	suspend fun next(): Pending?

	@Query( "SELECT * FROM outbox ORDER BY id" )
	fun observe(): Flow< List< Pending > >

	@Query( "SELECT * FROM outbox WHERE key = :key LIMIT 1" )
	suspend fun byKey( key: String ): Pending?

	@Update suspend fun update( item: Pending )
	@Delete suspend fun remove( item: Pending )

	@Query( "DELETE FROM outbox WHERE id = :id" )
	suspend fun removeById( id: Long )
}

@Dao
interface CacheDao {
	@Insert( onConflict = OnConflictStrategy.REPLACE )
	suspend fun put( row: Cached )

	@Query( "SELECT * FROM cache WHERE key = :key" )
	suspend fun get( key: String ): Cached?
}

@Database( entities = [ Pending::class, Cached::class ], version = 1, exportSchema = false )
abstract class Db : RoomDatabase() {
	abstract fun pending(): PendingDao
	abstract fun cache(): CacheDao

	companion object {
		@Volatile private var instance: Db? = null

		fun get( context: Context ): Db = instance ?: synchronized( this ) {
			instance ?: Room.databaseBuilder( context.applicationContext, Db::class.java, "handy.db" )
				.build()
				.also { instance = it }
		}
	}
}
