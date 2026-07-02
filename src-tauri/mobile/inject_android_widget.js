const fs = require('fs');
const path = require('path');

// Root of the Tauri project (run from src-tauri/mobile/ or project root)
const projectRoot = path.resolve(__dirname, '..', '..');

const widgetSourceDir = path.join(projectRoot, 'src-tauri', 'mobile', 'android-widget');
const genAndroidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');

console.log('--- Android Home Screen Widget Injector ---');
console.log('Source directory:', widgetSourceDir);
console.log('Target scaffolding directory:', genAndroidDir);

if (!fs.existsSync(genAndroidDir)) {
  console.error('Error: Android scaffolding not found. Run "npx tauri android init" first.');
  process.exit(1);
}

// 1. Destination paths
const mainResDir = path.join(genAndroidDir, 'app', 'src', 'main', 'res');
const mainJavaDir = path.join(genAndroidDir, 'app', 'src', 'main', 'java', 'com', 'honeyjournal', 'app');
const manifestPath = path.join(genAndroidDir, 'app', 'src', 'main', 'AndroidManifest.xml');

// 2. Helper function to copy files recursively
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
      console.log(`  Copied: ${element}`);
    }
  });
}

// 3. Copy Kotlin source code
console.log('Injecting Kotlin source files...');
const srcSource = path.join(widgetSourceDir, 'src', 'com', 'honeyjournal', 'app');
copyFolderSync(srcSource, mainJavaDir);

// 4. Copy layouts, XML configurations and drawables
console.log('Injecting XML layouts and resource drawables...');
const resSource = path.join(widgetSourceDir, 'res');
copyFolderSync(path.join(resSource, 'layout'), path.join(mainResDir, 'layout'));
copyFolderSync(path.join(resSource, 'xml'), path.join(mainResDir, 'xml'));
copyFolderSync(path.join(resSource, 'drawable'), path.join(mainResDir, 'drawable'));

// 5. Update AndroidManifest.xml
if (fs.existsSync(manifestPath)) {
  console.log('Updating AndroidManifest.xml...');
  let manifest = fs.readFileSync(manifestPath, 'utf8');

  // Check if widget components are already registered
  if (manifest.includes('SetupStatsWidgetProvider')) {
    console.log('  Widget is already registered in AndroidManifest.xml.');
  } else {
    // Inject widget declarations right before </application>
    const widgetDeclarations = `
        <!-- Setup Statistics App Widget -->
        <receiver
            android:name="com.honeyjournal.app.SetupStatsWidgetProvider"
            android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="com.honeyjournal.app.ACTION_TOGGLE_BULL" />
                <action android:name="com.honeyjournal.app.ACTION_TOGGLE_BEAR" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/widget_setup_stats_info" />
        </receiver>

        <service
            android:name="com.honeyjournal.app.WidgetRemoteViewsService"
            android:permission="android.permission.BIND_REMOTEVIEWS"
            android:exported="false" />
    `;

    const appCloseIndex = manifest.lastIndexOf('</application>');
    if (appCloseIndex !== -1) {
      manifest = manifest.slice(0, appCloseIndex) + widgetDeclarations + manifest.slice(appCloseIndex);
      console.log('  Successfully registered receiver and service inside <application>.');
    } else {
      console.error('  Error: Could not find </application> inside AndroidManifest.xml.');
    }

    // Ensure READ_EXTERNAL_STORAGE is declared
    if (!manifest.includes('READ_EXTERNAL_STORAGE')) {
      const manifestCloseIndex = manifest.lastIndexOf('</manifest>');
      if (manifestCloseIndex !== -1) {
        manifest = manifest.slice(0, manifestCloseIndex) + `    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />\n` + manifest.slice(manifestCloseIndex);
        console.log('  Successfully declared READ_EXTERNAL_STORAGE permission.');
      }
    }

    fs.writeFileSync(manifestPath, manifest, 'utf8');
  }
} else {
  console.error(`Error: AndroidManifest.xml not found at ${manifestPath}`);
  process.exit(1);
}

console.log('Android widget injection completed successfully!');
