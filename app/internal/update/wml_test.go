package update

import (
	"errors"
	"runtime"
	"testing"

	wmlupdate "github.com/yxxbc/wmlUpdate"
)

// TestWMLSourceMapping 钉住「用户选的源 → wmlUpdate source」的映射。
//
// Keep Video 只从自己的 GitHub Releases 发布：任何设置值（含旧版本留下的
// gitee / cnb / jsdelivr）都必须落到 oiov/keep.video，不能再指向上游镜像。
func TestWMLSourceMapping(t *testing.T) {
	for _, source := range []string{"auto", "github", "gitee", "cnb", "jsdelivr", ""} {
		sc := wmlSource(source, nil)
		if sc.Type != wmlupdate.SourceGitHub {
			t.Fatalf("%q: type = %q, want github", source, sc.Type)
		}
		if sc.Owner != "oiov" || sc.Repo != "keep.video" || sc.TagPrefix != "v" {
			t.Fatalf("%q: repo = %s/%s prefix %q", source, sc.Owner, sc.Repo, sc.TagPrefix)
		}
	}

	t.Run("测试注入的清单走 static", func(t *testing.T) {
		sc := wmlSource("auto", []string{"http://127.0.0.1/manifest.json"})
		if sc.Type != wmlupdate.SourceStatic || len(sc.ManifestURLs) != 1 {
			t.Fatalf("source = %+v, want static", sc)
		}
	})
}

// TestWMLAssetRulesOrder 钉住平台资产的选择顺序。
//
// 第一规则必须是可自动安装的形态；后备规则只用于发现版本。
func TestWMLAssetRulesOrder(t *testing.T) {
	rules := wmlAssetRules()
	want := []struct {
		os     string
		match  string
		format string
	}{
		{"darwin", "KeepVideo-Desktop-mac-universal-{version}.zip", "zip"},
		{"darwin", "KeepVideo-Desktop-mac-universal-{version}.dmg", "dmg"},
		{"windows", "KeepVideo-Desktop-windows-x64-{version}-installer.exe", "exe"},
		{"windows", "KeepVideo-Desktop-windows-x64-{version}.zip", "zip"},
		{"linux", "KeepVideo-Desktop-linux-x64-{version}.AppImage", "raw"},
		{"linux", "KeepVideo-Desktop-linux-x64-{version}.tar.gz", "tar.gz"},
		{"linux", "KeepVideo-Desktop-linux-x64-{version}.deb", "raw"},
	}
	if len(rules) != len(want) {
		t.Fatalf("rules = %d, want %d", len(rules), len(want))
	}
	for i := range want {
		if rules[i].OS != want[i].os || rules[i].Match != want[i].match || rules[i].Format != want[i].format {
			t.Errorf("rule[%d] = %+v, want %+v", i, rules[i], want[i])
		}
	}
}

// TestWMLInstallableKind 钉住「哪些产物可以自动安装」。
//
// 后备资产（dmg / zip / deb）只能用来发现版本；如果这里放行，用户会下载
// 一个装不上的包，然后在 InstallUpdate 里失败。
func TestWMLInstallableKind(t *testing.T) {
	zipName := "KeepVideo-Desktop-mac-universal-1.7.3.zip"
	dmgName := "KeepVideo-Desktop-mac-universal-1.7.3.dmg"
	exeName := "KeepVideo-Desktop-windows-x64-1.7.3-installer.exe"
	winZipName := "KeepVideo-Desktop-windows-x64-1.7.3.zip"
	appImageName := "KeepVideo-1.7.3.AppImage"
	tarName := "KeepVideo-Desktop-linux-x64-1.7.3.tar.gz"

	switch runtime.GOOS {
	case "darwin":
		if got := WMLInstallableKind(zipName); got != KindZip {
			t.Errorf("zip = %q, want zip", got)
		}
		if got := WMLInstallableKind(dmgName); got != KindUnsupported {
			t.Errorf("dmg = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(exeName); got != KindUnsupported {
			t.Errorf("exe = %q, want unsupported", got)
		}
	case "windows":
		if got := WMLInstallableKind(exeName); got != KindNsis {
			t.Errorf("exe = %q, want nsis", got)
		}
		if got := WMLInstallableKind(winZipName); got != KindUnsupported {
			t.Errorf("zip = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(dmgName); got != KindUnsupported {
			t.Errorf("dmg = %q, want unsupported", got)
		}
	case "linux":
		if got := WMLInstallableKind(appImageName); got != KindAppImage {
			t.Errorf("appimage = %q, want appimage", got)
		}
		if got := WMLInstallableKind(tarName); got != KindUnsupported {
			t.Errorf("tar.gz = %q, want unsupported", got)
		}
		if got := WMLInstallableKind(zipName); got != KindUnsupported {
			t.Errorf("zip = %q, want unsupported", got)
		}
	}
}

func TestWMLConfigCarriesRuntimeOptions(t *testing.T) {
	cfg := WMLConfig(WMLOptions{
		Source:         "auto",
		CurrentVersion: "1.7.3",
		Proxy:          "socks5://127.0.0.1:7890",
		StateDir:       "/tmp/keepvideo-updater",
	})
	if cfg.AppID != WMLAppID || cfg.Channel != WMLChannel {
		t.Fatalf("app id/channel = %q/%q", cfg.AppID, cfg.Channel)
	}
	if cfg.CurrentVersion != "1.7.3" {
		t.Fatalf("current version = %q", cfg.CurrentVersion)
	}
	if cfg.Install.Type != wmlupdate.InstallExternal {
		t.Fatalf("install type = %q, want external", cfg.Install.Type)
	}
	if cfg.Download.Proxy != "socks5://127.0.0.1:7890" {
		t.Fatalf("proxy = %q", cfg.Download.Proxy)
	}
	if cfg.StateDir != "/tmp/keepvideo-updater" {
		t.Fatalf("state dir = %q", cfg.StateDir)
	}
}

func TestWMLErrorCode(t *testing.T) {
	if got := WMLErrorCode(nil); got != "" {
		t.Fatalf("nil = %q, want empty", got)
	}
	if got := WMLErrorCode(errors.New("boom")); got != "internal" {
		t.Fatalf("plain error = %q, want internal", got)
	}
	if got := WMLErrorCode(&wmlupdate.Error{Code: "no_asset", Err: errors.New("boom")}); got != "no_asset" {
		t.Fatalf("typed error = %q, want no_asset", got)
	}
}
