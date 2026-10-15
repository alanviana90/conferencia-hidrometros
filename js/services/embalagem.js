// @ts-check
export const EMBALAGENS = {
  '3/4': { label: '3/4 polegada — saco com 20 peças', capacidade: 20 },
  '1': { label: '1 polegada — saco com 10 peças', capacidade: 10 },
  maior: { label: 'Acima de 1 polegada — fora do saco, sem lacre', capacidade: 0 },
};

/** Só interpreta diâmetros explícitos; vazão em m³/h não determina polegadas. */
export function identificarEmbalagem(descricao = '') {
  const text = String(descricao).trim().toLowerCase().replace(/[“”″]/g, '"')
    .replace(/¾/g, '3/4').replace(/½/g, '1/2');
  const sizes = new Set();
  const pattern = /(?:^|[^\d.,/])(\d+\s*[. -]?\s+\d+\s*\/\s*\d+|\d+\.\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(?:["']|pol(?:egadas?)?\b)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1].trim();
    let size;
    const mixed = raw.match(/^(\d+)[.\s-]+(\d+)\s*\/\s*(\d+)$/);
    const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (mixed) size = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    else if (fraction) size = Number(fraction[1]) / Number(fraction[2]);
    else size = Number(raw.replace(',', '.'));
    if (size === 0.75) sizes.add('3/4');
    else if (size === 1) sizes.add('1');
    else if (size > 1 && Number.isFinite(size)) sizes.add('maior');
  }
  return sizes.size === 1 ? [...sizes][0] : '';
}

export function embalagemDoRegistro(record) {
  return record?.embalagem || identificarEmbalagem(record?.descricao);
}

/** Um lacre identifica um saco de um único tamanho. */
export function validarSaco(itens, lacre, embalagem, excludingSerie = '') {
  const rule = EMBALAGENS[embalagem];
  if (!rule) throw new Error('Selecione o tamanho do hidrômetro.');
  if (!rule.capacidade) return;
  if (!lacre) throw new Error('Informe o número do lacre.');
  const members = itens.filter(i => ['ENCONTRADO', 'ADICIONADO', 'FORA_DO_FILTRO'].includes(i.status) && i.lote === lacre &&
    (i.hidrometroSnapshot?.numeroSerieNorm || i.numeroSerieDigitado?.trim().toUpperCase()) !== excludingSerie);
  if (members.some(i => { const kind = embalagemDoRegistro(i.hidrometroSnapshot); return kind && kind !== embalagem; })) {
    throw new Error('Este lacre já pertence a um saco de outro tamanho. Informe outro lacre.');
  }
  const count = new Set(members.map(i => i.hidrometroSnapshot?.numeroSerieNorm || i.numeroSerieDigitado?.trim().toUpperCase())).size;
  if (count >= rule.capacidade) throw new Error(`Este saco já tem ${rule.capacidade} hidrômetros. Informe outro lacre.`);
}
