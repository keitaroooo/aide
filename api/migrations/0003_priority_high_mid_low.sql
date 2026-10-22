-- 優先度: 0=低 1=中 2=高（人の感覚。旧 0=普通→中、旧 1=高→高）
UPDATE tasks SET priority = CASE WHEN priority >= 1 THEN 2 ELSE 1 END;
