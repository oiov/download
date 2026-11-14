// Package activity 持久化每天的下载次数，供首页热力图使用。
//
// ## 为什么不直接从历史聚合
//
// 下载历史上限 100 条（history.MaxRecords），且同一个本地文件只保留一条。
// 下载频繁的用户一周就能把历史挤满，热力图于是只剩最近几天有颜色，
// 更早的格子全部「变空」——看起来像是从没用过。
//
// 所以按天单独计数：每完成一次下载在当天 +1，与历史条数、删除、清空无关。
// 文件很小（每天一个键，保留 KeepDays 天），落在 `~/.keepvideo/activity.json`。
package activity

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// KeepDays 是计数的保留天数。热力图只画一年，多留一些给跨年对比。
const KeepDays = 400

// DateLayout 是日期键的格式（本地日期）。
const DateLayout = "2006-01-02"

type file struct {
	Version int            `json:"version"`
	Days    map[string]int `json:"days"`
}

// Load 读取每天的计数。文件不存在时返回空表和 fs.ErrNotExist。
func Load(path string) (map[string]int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]int{}, err
	}
	var f file
	if err := json.Unmarshal(data, &f); err != nil {
		return map[string]int{}, err
	}
	return clean(f.Days), nil
}

// Record 在 at 所在的本地日期上 +1，并裁掉 KeepDays 之前的数据。
//
// 文件损坏时从空表重新开始：计数只是统计，不该因为它让下载流程报错。
func Record(path string, at time.Time) (map[string]int, error) {
	days, _ := Load(path)
	days[at.Local().Format(DateLayout)]++
	days = Prune(days, at)
	return days, Save(path, days)
}

// Seed 在计数文件还不存在时，用已有历史的 createdAt 补一份初值。
//
// 只在**第一次**生效：从 Electron 版或旧版本升级上来的用户，热力图
// 不该从零开始；之后历史被删、被挤出上限都不再影响计数。
func Seed(path string, createdAt []string, now time.Time) (map[string]int, error) {
	days, err := Load(path)
	if err == nil || !errors.Is(err, fs.ErrNotExist) {
		return days, nil
	}
	seeded := map[string]int{}
	for _, raw := range createdAt {
		at, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			continue
		}
		seeded[at.Local().Format(DateLayout)]++
	}
	seeded = Prune(seeded, now)
	return seeded, Save(path, seeded)
}

// Prune 去掉早于 now 之前 KeepDays 天的日期，以及无法解析的键。
func Prune(days map[string]int, now time.Time) map[string]int {
	cutoff := now.Local().AddDate(0, 0, -KeepDays).Format(DateLayout)
	out := make(map[string]int, len(days))
	for key, count := range clean(days) {
		if key >= cutoff {
			out[key] = count
		}
	}
	return out
}

func clean(days map[string]int) map[string]int {
	out := make(map[string]int, len(days))
	for key, count := range days {
		if count <= 0 {
			continue
		}
		if _, err := time.Parse(DateLayout, key); err != nil {
			continue
		}
		out[key] = count
	}
	return out
}

// Save 原子写入（同目录临时文件 + rename）。
func Save(path string, days map[string]int) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(file{Version: 1, Days: clean(days)})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".activity-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
