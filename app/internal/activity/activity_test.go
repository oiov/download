package activity

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 计数不受历史上限影响：同一天记录 150 次，读回来就是 150。
func TestRecordCountsBeyondHistoryLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "activity.json")
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.Local)
	for i := 0; i < 150; i++ {
		if _, err := Record(path, now); err != nil {
			t.Fatal(err)
		}
	}
	days, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := days["2026-11-14"]; got != 150 {
		t.Fatalf("当天计数 = %d，期望 150", got)
	}
}

// 超过保留期的日期要被裁掉，否则文件会无限增长。
func TestRecordPrunesOldDays(t *testing.T) {
	path := filepath.Join(t.TempDir(), "activity.json")
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.Local)
	old := now.AddDate(0, 0, -(KeepDays + 5)).Format(DateLayout)
	if err := Save(path, map[string]int{old: 3, "2026-11-01": 2}); err != nil {
		t.Fatal(err)
	}
	days, err := Record(path, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := days[old]; ok {
		t.Fatalf("超过 %d 天的 %s 应被裁掉", KeepDays, old)
	}
	if days["2026-11-01"] != 2 || days["2026-11-14"] != 1 {
		t.Fatalf("保留期内的计数被改动：%v", days)
	}
}

// Seed 只在文件不存在时生效；已有计数后再 Seed 不能覆盖或重复累加。
func TestSeedOnlyOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "activity.json")
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	created := []string{
		now.Format(time.RFC3339Nano),
		now.Add(-time.Minute).Format(time.RFC3339Nano),
		"不是时间",
	}
	days, err := Seed(path, created, now)
	if err != nil {
		t.Fatal(err)
	}
	key := now.Local().Format(DateLayout)
	if days[key] != 2 {
		t.Fatalf("首次 Seed 应得到 2，实际 %v", days)
	}
	again, err := Seed(path, created, now)
	if err != nil {
		t.Fatal(err)
	}
	if again[key] != 2 {
		t.Fatalf("第二次 Seed 不应重复累加，实际 %v", again)
	}
}

// 损坏的文件不能让下载流程报错：从空表重新计数。
func TestRecordRecoversFromCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "activity.json")
	if err := os.WriteFile(path, []byte("{oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	days, err := Record(path, time.Date(2026, 11, 14, 10, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}
	if days["2026-11-14"] != 1 {
		t.Fatalf("损坏文件后应从 1 开始，实际 %v", days)
	}
}
