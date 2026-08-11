const fs = require('fs');
const path = require('path');

const translations = {
  'ar': 'اسحب للاستخراج',
  'de': 'Zum Extrahieren ziehen',
  'en': 'Drag to extract',
  'es': 'Arrastrar para extraer',
  'fr': 'Faites glisser pour extraire',
  'hi': 'निकालने के लिए खींचें',
  'id': 'Tarik untuk mengekstrak',
  'ja': 'ドラッグして抽出',
  'ko': '드래그하여 추출',
  'pt-BR': 'Arraste para extrair',
  'ru': 'Перетащите для извлечения',
  'tr': 'Dosyayı klasöre sürükle',
  'vi': 'Kéo để trích xuất',
  'zh-CN': '拖动以提取'
};

const dir = 'frontend/src/i18n';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (let file of files) {
  const lang = path.basename(file, '.js');
  if (translations[lang]) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (!content.includes('tip_drag_file')) {
      const injection = `\n  tip_drag_file: "${translations[lang]}",`;
      content = content.replace(/(export default \{|const [a-zA-Z]+ = \{)/, `$1${injection}`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated ' + file);
    } else {
      console.log('Skipped (already exists): ' + file);
    }
  }
}
