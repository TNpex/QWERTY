import { describe, it, expect } from 'vitest';
import { parseCredentials } from './saletennisAuth';

describe('parseCredentials', () => {
  it('разбирает валидные учётные данные', () => {
    expect(parseCredentials(JSON.stringify({ login: ' shop@mail.ru ', password: 'secret' }))).toEqual({
      login: 'shop@mail.ru',
      password: 'secret',
    });
  });

  it('мусор, пустые значения и не-строки → null', () => {
    expect(parseCredentials('{oops')).toBeNull();
    expect(parseCredentials(JSON.stringify({ login: '', password: 'x' }))).toBeNull();
    expect(parseCredentials(JSON.stringify({ login: 'a', password: '' }))).toBeNull();
    expect(parseCredentials(JSON.stringify({ login: 5, password: 'x' }))).toBeNull();
    expect(parseCredentials('[]')).toBeNull();
  });
});
