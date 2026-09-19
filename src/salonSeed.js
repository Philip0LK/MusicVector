// 《沙龙》种子歌曲的唯一构造。这里只依赖 structuredClone，不碰 React、IndexedDB 或 AI 模块，
// 因此浏览器训练页、手机端导出与 Node fixture 生成可以共用同一份数据。
export const seedSong = {
  id: 'salon',
  title: '沙龙',
  key: 'E',
  octave: 4,
  bpm: 80,
  completed: true,
  stage: 'recognition',
  images: [1, 2, 3, 4].map((n) => ({
    id: 'salon-' + n,
    name: '沙龙原谱 ' + n + '.jpg',
    src: '/song/images/00' + n + '.jpg',
    status: 'done',
    simulated: false,
  })),
};

export function salonSeedSong(document) {
  const rows = Array.isArray(document?.rows) ? document.rows : [];
  return {
    ...seedSong,
    ...(document?.music ? { music: structuredClone(document.music) } : {}),
    images: seedSong.images.map((image, page) => ({
      ...image,
      result: {
        rows: rows
          .map((r, index) => ({
            ...r,
            originalRow: index,
            origin: 'salon',
            id: `salon-row-${index}`,
            notes: r.notes.map((n, i) => ({
              ...n,
              id: `salon-row-${index}-note-${i}`,
              annotation: { ...n.annotation, originalTie: n.annotation.tieToNext },
            })),
          }))
          .filter((r) => r.page === page),
      },
    })),
  };
}
