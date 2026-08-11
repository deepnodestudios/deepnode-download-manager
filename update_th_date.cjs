const fs = require('fs');
const path = require('path');

const translations = {
  'ar': 'تاريخ الإضافة',
  'de': 'Hinzugefügt am',
  'en': 'Date Added',
  'es': 'Fecha añadida',
  'fr': "Date d\\'ajout",
  'hi': 'जोड़ने की तिथि',
  'id': 'Tanggal Ditambahkan',
  'ja': '追加日',
  'ko': '추가된 날짜',
  'pt-BR': 'Data de Adição',
  'ru': 'Дата добавления',
  'tr': 'Eklenme Tarihi',
  'vi': 'Ngày thêm',
  'zh-CN': '添加日期'
};

const dir = 'frontend/src/i18n';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'index.js');

for (let file of files) {
  const lang = path.basename(file, '.js');
  if (translations[lang]) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace th_date value
    content = content.replace(/th_date\s*:\s*(['"`]).*?\1,/, `th_date: '${translations[lang]}',`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated th_date for ' + file);
  }
}
