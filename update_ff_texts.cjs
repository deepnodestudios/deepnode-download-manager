const fs = require('fs');
const path = require('path');

const translations = {
  ar: { ff_store_install: 'يمكنك تثبيت إضافة Firefox مباشرة من متجر Mozilla Add-ons:', btn_install_amo: 'تثبيت من Mozilla Add-ons' },
  de: { ff_store_install: 'Sie können die Firefox-Erweiterung direkt aus dem Mozilla Add-ons Store installieren:', btn_install_amo: 'Aus Mozilla Add-ons installieren' },
  en: { ff_store_install: 'You can install the Firefox extension directly from the Mozilla Add-ons store:', btn_install_amo: 'Install from Mozilla Add-ons' },
  es: { ff_store_install: 'Puedes instalar la extensión de Firefox directamente desde la tienda de complementos de Mozilla:', btn_install_amo: 'Instalar desde Mozilla Add-ons' },
  fr: { ff_store_install: "Vous pouvez installer l'extension Firefox directement depuis le magasin de modules complémentaires de Mozilla :", btn_install_amo: 'Installer depuis Mozilla Add-ons' },
  hi: { ff_store_install: 'आप मोज़िला ऐड-ऑन स्टोर से सीधे फ़ायरफ़ॉक्स एक्सटेंशन इंस्टॉल कर सकते हैं:', btn_install_amo: 'मोज़िला ऐड-ऑन से इंस्टॉल करें' },
  id: { ff_store_install: 'Anda dapat menginstal ekstensi Firefox langsung dari toko Add-on Mozilla:', btn_install_amo: 'Instal dari Mozilla Add-ons' },
  ja: { ff_store_install: 'Mozilla アドオンストアから直接 Firefox 拡張機能をインストールできます:', btn_install_amo: 'Mozilla アドオンからインストール' },
  ko: { ff_store_install: 'Mozilla Add-ons 스토어에서 직접 Firefox 확장 프로그램을 설치할 수 있습니다:', btn_install_amo: 'Mozilla Add-ons에서 설치' },
  'pt-BR': { ff_store_install: 'Você pode instalar a extensão do Firefox diretamente da loja de complementos da Mozilla:', btn_install_amo: 'Instalar do Mozilla Add-ons' },
  ru: { ff_store_install: 'Вы можете установить расширение Firefox прямо из магазина дополнений Mozilla:', btn_install_amo: 'Установить из Mozilla Add-ons' },
  tr: { ff_store_install: 'Firefox eklentisini doğrudan Mozilla Add-ons mağazasından kurabilirsiniz:', btn_install_amo: "Mozilla Add-ons'tan Kur" },
  vi: { ff_store_install: 'Bạn có thể cài đặt tiện ích mở rộng Firefox trực tiếp từ cửa hàng Tiện ích bổ sung Mozilla:', btn_install_amo: 'Cài đặt từ Mozilla Add-ons' },
  'zh-CN': { ff_store_install: '您可以直接从 Mozilla 附加组件商店安装 Firefox 扩展：', btn_install_amo: '从 Mozilla Add-ons 安装' }
};

const dir = 'frontend/src/i18n';
const files = Object.keys(translations).map(k => k + '.js');

files.forEach(file => {
  const lang = path.basename(file, '.js');
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  const langObj = translations[lang];
  
  Object.keys(langObj).forEach(key => {
    let val = langObj[key].replace(/'/g, "\\'");
    let regex = new RegExp(`^\\s*${key}\\s*:\\s*(['"\`]).*?\\1,`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, `  ${key}: '${val}',`);
    } else {
        content = content.replace(/(export default \{|const [a-zA-Z]+ = \{)/, `$1\n  ${key}: '${val}',`);
    }
  });

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fully translated ' + file);
});
