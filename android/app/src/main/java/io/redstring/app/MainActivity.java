package com.redstring.app;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Redstring runs fullscreen — no status bar, no navigation bar.
 *
 * WHY. The app is a canvas, and on the small landscape devices it targets the
 * system bars are not a rounding error: on a Retroid Pocket 6 the status bar is
 * 55px and the navigation bar 111px against a 1080px-tall display, so 15% of
 * the vertical budget goes to chrome the app never uses. In CSS pixels that is
 * 72 of 468. The fullscreen landscape shell exists to buy back exactly that
 * kind of space (see hooks/useMobileLandscapeShell.js) and it makes no sense
 * for the app to reclaim the header while Android keeps two bands of its own.
 *
 * HOW. setDecorFitsSystemWindows(false) lays the WebView out edge to edge, and
 * the insets controller hides both bars. BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
 * is the escape hatch: a swipe from either edge brings the bars back for a few
 * seconds, so Back and Home stay reachable on a device with no physical keys,
 * and then they leave again on their own. The alternative behaviours either
 * pin the bars permanently or make the reveal sticky, and both would put the
 * chrome back over the canvas for good.
 *
 * WHY onWindowFocusChanged TOO. Hiding the bars is not durable. Android brings
 * them back whenever the window loses and regains focus — a notification shade
 * pull, a permission dialog, an app switch, the IME opening — and it does so
 * silently. Re-applying on focus is the standard way to keep the state, and it
 * is cheap: the controller no-ops when the bars are already hidden.
 *
 * The cutout mode matters on phones rather than handhelds, but it belongs with
 * the rest: having gone edge to edge, SHORT_EDGES lets the page paint into the
 * notch band as well, which is what index.html's viewport-fit=cover and the
 * safe-area padding in App.css are already written to handle.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        applyFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyFullscreen();
        }
    }

    private void applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller == null) {
            return;
        }

        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
