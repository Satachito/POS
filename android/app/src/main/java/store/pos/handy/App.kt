package store.pos.handy

import android.app.Application

class App : Application() {
	lateinit var repo: Repo
		private set

	override fun onCreate() {
		super.onCreate()
		repo = Repo( this )
	}
}
