# Professional IPTV Receiver Integration Guide

Achour Player is now optimized for Android TV, Fire TV Stick, and Landscape phones.

## 1. Project Structure

Move the provided files into your Android Studio project:

- `/android/build.gradle` -> `build.gradle` (Project)
- `/android/app_build.gradle` -> `app/build.gradle`
- `/android/settings.gradle` -> `settings.gradle`
- `/android/AndroidManifest.xml` -> `app/src/main/AndroidManifest.xml`
- `/android/PlayerActivity.kt` -> `app/src/main/java/com/achour/player/PlayerActivity.kt`
- `/android/MainActivity.kt` -> `app/src/main/java/com/achour/player/MainActivity.kt`
- `/android/AchourNativeInterface.kt` -> `app/src/main/java/com/achour/player/AchourNativeInterface.kt`
- `/android/activity_player.xml` -> `app/src/main/res/layout/activity_player.xml`

## 2. Key Features Implemented

1.  **Landscape Lock**: Forced in `AndroidManifest.xml` for both Main and Player activities.
2.  **TV Navigation**: 
    - Full D-pad support implemented in the React layer (`LivePlayer.tsx`).
    - Visible focus states defined in `index.css`.
    - `LEANBACK_LAUNCHER` added for Android TV discovery.
3.  **Media3 Player**: Native ExoPlayer handling `.ts` and `.m3u8` with custom headers to avoid 404 errors.
4.  **Receiver Interface**:
    - Sidebar categories including "Recently Watched" and "Favorites".
    - Channel numbers and logos.
    - Zapping HUD (Quick channel switching).

## 3. Remote Control Support

- **OK / Enter**: Shows/Hides controls and info bar.
- **UP / DOWN**: Switches channels when controls are hidden.
- **BACK**: Returns to the previous menu or closes the player.

## 4. Why this is Buildable

All dependencies are pinned to stable versions in the provided Gradle files. The manifest includes the necessary hardware feature declarations for non-touchscreen devices (Fire Stick).
