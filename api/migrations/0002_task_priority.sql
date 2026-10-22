-- 0 = 普通, 1 = 高。ユーザーが付ける。AI が勝手に付けない。
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
