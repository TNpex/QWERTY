import { describe, it, expect } from 'vitest';
import { localPhotoUrl, localPhotoCandidates } from './images';

describe('localPhotoUrl', () => {
  it('строит URL в public/data/product_images с экранированием', () => {
    expect(localPhotoUrl('943ea3091107.png')).toBe('/data/product_images/943ea3091107.png');
    expect(localPhotoUrl('имя файл.png')).toBe('/data/product_images/%D0%B8%D0%BC%D1%8F%20%D1%84%D0%B0%D0%B9%D0%BB.png');
  });
});

describe('localPhotoCandidates', () => {
  it('сначала WebP-версия, затем оригинал', () => {
    expect(localPhotoCandidates('943ea3091107.png')).toEqual([
      '/data/product_images/943ea3091107.webp',
      '/data/product_images/943ea3091107.png',
    ]);
    expect(localPhotoCandidates('photo.JPG')).toEqual([
      '/data/product_images/photo.webp',
      '/data/product_images/photo.JPG',
    ]);
  });

  it('для уже webp — один кандидат', () => {
    expect(localPhotoCandidates('x.webp')).toEqual(['/data/product_images/x.webp']);
  });
});
