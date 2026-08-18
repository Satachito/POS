plugins {
	alias( libs.plugins.android.application )
	alias( libs.plugins.kotlin.android )
	alias( libs.plugins.kotlin.compose )
	alias( libs.plugins.kotlin.serialization )
	alias( libs.plugins.ksp )
}

android {
	namespace	= "store.pos.handy"
	compileSdk	= 36

	defaultConfig {
		applicationId	= "store.pos.handy"
		minSdk			= 26
		targetSdk		= 36
		versionCode		= 1
		versionName		= "0.1"
	}

	buildTypes {
		release { isMinifyEnabled = false }
	}

	compileOptions {
		sourceCompatibility	= JavaVersion.VERSION_17
		targetCompatibility	= JavaVersion.VERSION_17
	}

	kotlinOptions { jvmTarget = "17" }

	buildFeatures { compose = true }
}

dependencies {
	implementation( platform( libs.compose.bom ) )
	implementation( libs.compose.ui )
	implementation( libs.compose.ui.tooling.preview )
	implementation( libs.compose.material3 )
	debugImplementation( libs.compose.ui.tooling )

	implementation( libs.androidx.core.ktx )
	implementation( libs.androidx.activity.compose )
	implementation( libs.androidx.lifecycle.runtime )
	implementation( libs.androidx.lifecycle.compose )
	implementation( libs.androidx.lifecycle.viewmodel )
	implementation( libs.androidx.navigation.compose )

	implementation( libs.room.runtime )
	implementation( libs.room.ktx )
	ksp( libs.room.compiler )

	implementation( libs.datastore.preferences )
	implementation( libs.okhttp )
	implementation( libs.kotlinx.serialization.json )
	implementation( libs.kotlinx.coroutines.android )
}
