import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// 正式签名从 android/keystore.properties 读取（该文件与密钥库都不进仓库）。
// 没有它时照常可以构建调试版与运行测试，只是打不出可发布的正式包。
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) keystorePropertiesFile.inputStream().use { load(it) }
}

android {
    namespace = "com.yuebeidou.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yuebeidou.player"
        minSdk = 26
        targetSdk = 35
        // 每次对外发布都要把 versionCode 加一，否则用户端不认为是新版本。
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // 调试版用独立包名，可与正式版同时装在手机上，数据互不影响。
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = false
            if (keystorePropertiesFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        compose = true
    }

    androidResources {
        // 采样必须保持未压缩，SoundPool 才能用 AssetFileDescriptor 直接加载。
        noCompress += "ogg"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }

    testOptions {
        // Robolectric 冒烟测试要读打包资源与真实 Context（filesDir / SharedPreferences / assets）。
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    // 扫码只用这一个第三方依赖（纯 Java 的 zxing core），运行期完全离线。
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    // JVM 单测没有 Android 平台的 org.json 实现，补一个纯 Java 版本。
    testImplementation("org.json:json:20240303")
    // 运行期冒烟测试：在 JVM 上跑真实 Context 与打包资源（采样路径、落盘、设置）。
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
