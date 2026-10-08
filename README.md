# Acu Map

A model-first acupuncture point viewer using the same full-screen interface language as the local Anatomy Viewer app.

## Current interface

- Full-viewport Male/Female 3D body models extracted from the supplied APK
- Native point coordinates retained in the same Unity scene space as the bodies
- A slide-in **Find Point** panel organized by meridian, with one square tile per point
- Selecting one meridian shows compact point-code and Chinese-name labels beside its body points
- Selected points keep their body label visible, and prescription points use an orange pulse highlight
- Point and meridian-line overlays enabled on startup; unfinished skin zones remain off until explicitly enabled
- Meridian curves are projected onto the native skin meshes instead of drawing straight point-to-point chords
- Full / Hide L / Hide R section controls reveal the supplied APK's native bones and internal organs together while retaining points and meridians
- Computed meridian skin zones expand at a consistent average width around each registered surface path, with smoothed borders reprojected onto the skin, and follow channel visibility
- APK-native proportional rulers for Head, Torso, Arm, Hand, and Leg/foot, loaded on demand and independently filterable
- Meridian paths can switch between perforated and solid line styles
- Anatomical branch breaks are preserved, including the gap between BL40 and BL41
- Search by point code, English, Chinese, Korean, or pinyin name
- Built-in AcuAcu point-combination library with source-review status retained per record
- Locally saved custom prescriptions with a name, point list, and user-authored description
- Gentle pulsing 3D highlights for every point in the active built-in or custom combination
- Menu selection highlights both left and right locations; direct body selection keeps the tapped side specific
- A compact meridian / pinyin / Chinese point label opens the full reference details on demand
- Point calibration remains available under **Meridians**
- Responsive controls for phone and tablet widths

The body meshes and acupuncture records were extracted from the user-supplied `免费找穴位神器.apk`. They remain source-derived study material with point placement and clinical content pending practitioner review.

The built-in prescription library is generated from the local `C:\Users\ASUS\Documents\AcuAcu` clinical library. It includes its source-review status and source locators. It remains study material, not individualized treatment advice. Custom prescriptions are stored only in the browser/Android WebView local storage on that device.

## Run locally

```powershell
npm ci
npm run dev
```

The app uses its local `public` folder by default. Override it only for a deliberate alternate build:

```powershell
$env:ACU_MAP_ASSET_ROOT = 'D:\path\to\viewer-assets'
npm run dev
```

Then open `http://127.0.0.1:4330/`.

For normal local use, double-click `Open Acu Map Website.cmd`. It starts the packaged-site server in the background and opens the correct address automatically. Do not open `web\index.html` or `app\src\main\assets\index.html` directly.

## Verify the responsive UI

With the development server running:

```powershell
npm run check:ui
```

Screenshots are written to `verification/`.

Validate the generated surface paths independently with:

```powershell
npm run check:paths
npm run check:anatomy
npm run check:zones
npm run check:rulers
```

## Build the Android APK

The build uses the local Android/JDK toolchain already configured for the Anatomy Viewer:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-android.ps1
```

The debug-signed APK is written to `app\build\outputs\apk\debug\app-debug.apk`. It is fully offline and includes the compact native Male/Female source models.
