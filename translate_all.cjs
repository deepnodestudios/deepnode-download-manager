const fs = require('fs');
const path = require('path');

const translations = {
  ar: {
    ctx_refresh_url: 'تحديث الرابط',
    refresh_modal_title: 'تحديث رابط التنزيل',
    refresh_modal_desc: 'لقد انتهت صلاحية رابط هذا التنزيل. يرجى إدخال الرابط الجديد لاستئناف التنزيل.',
    refresh_modal_label: 'الرابط الجديد',
    refresh_modal_btn: 'تحديث الرابط',
    opt_default: 'افتراضي',
    opt_alt_default: 'Alt (افتراضي)',
    st_canceled: 'تم الإلغاء',
    th_date: 'تاريخ الإضافة'
  },
  de: {
    ctx_refresh_url: 'URL aktualisieren',
    refresh_modal_title: 'Download-URL aktualisieren',
    refresh_modal_desc: 'Die URL für diesen Download ist abgelaufen. Bitte geben Sie die neue URL ein, um den Download fortzusetzen.',
    refresh_modal_label: 'Neue URL',
    refresh_modal_btn: 'URL aktualisieren',
    opt_default: 'Standard',
    opt_alt_default: 'Alt (Standard)',
    st_canceled: 'Abgebrochen',
    th_date: 'Hinzugefügt am'
  },
  en: {
    ctx_refresh_url: 'Refresh URL',
    refresh_modal_title: 'Refresh Download URL',
    refresh_modal_desc: 'The URL for this download has expired. Please enter the new URL to resume downloading.',
    refresh_modal_label: 'New URL',
    refresh_modal_btn: 'Update URL',
    opt_default: 'default',
    opt_alt_default: 'Alt (default)',
    st_canceled: 'Canceled',
    th_date: 'Date Added'
  },
  es: {
    ctx_refresh_url: 'Actualizar URL',
    refresh_modal_title: 'Actualizar URL de descarga',
    refresh_modal_desc: 'La URL de esta descarga ha expirado. Por favor, introduzca la nueva URL para reanudar la descarga.',
    refresh_modal_label: 'Nueva URL',
    refresh_modal_btn: 'Actualizar URL',
    opt_default: 'predeterminado',
    opt_alt_default: 'Alt (predeterminado)',
    st_canceled: 'Cancelado',
    th_date: 'Fecha añadida'
  },
  fr: {
    ctx_refresh_url: "Actualiser l'URL",
    refresh_modal_title: "Actualiser l'URL de téléchargement",
    refresh_modal_desc: "L'URL de ce téléchargement a expiré. Veuillez entrer la nouvelle URL pour reprendre le téléchargement.",
    refresh_modal_label: 'Nouvelle URL',
    refresh_modal_btn: "Mettre à jour l'URL",
    opt_default: 'par défaut',
    opt_alt_default: 'Alt (par défaut)',
    st_canceled: 'Annulé',
    th_date: "Date d'ajout"
  },
  hi: {
    ctx_refresh_url: 'URL रीफ़्रेश करें',
    refresh_modal_title: 'डाउनलोड URL रीफ़्रेश करें',
    refresh_modal_desc: 'इस डाउनलोड के लिए URL समाप्त हो गया है। डाउनलोड फिर से शुरू करने के लिए कृपया नया URL दर्ज करें।',
    refresh_modal_label: 'नया URL',
    refresh_modal_btn: 'URL अपडेट करें',
    opt_default: 'डिफ़ॉल्ट',
    opt_alt_default: 'Alt (डिफ़ॉल्ट)',
    st_canceled: 'रद्द किया गया',
    th_date: 'जोड़ने की तिथि'
  },
  id: {
    ctx_refresh_url: 'Segarkan URL',
    refresh_modal_title: 'Segarkan URL Unduhan',
    refresh_modal_desc: 'URL untuk unduhan ini telah kedaluwarsa. Silakan masukkan URL baru untuk melanjutkan unduhan.',
    refresh_modal_label: 'URL Baru',
    refresh_modal_btn: 'Perbarui URL',
    opt_default: 'bawaan',
    opt_alt_default: 'Alt (bawaan)',
    st_canceled: 'Dibatalkan',
    th_date: 'Tanggal Ditambahkan'
  },
  ja: {
    ctx_refresh_url: 'URLを更新',
    refresh_modal_title: 'ダウンロードURLを更新',
    refresh_modal_desc: 'このダウンロードのURLは有効期限が切れています。ダウンロードを再開するには、新しいURLを入力してください。',
    refresh_modal_label: '新しいURL',
    refresh_modal_btn: 'URLを更新',
    opt_default: '既定',
    opt_alt_default: 'Alt（既定）',
    st_canceled: 'キャンセルされました',
    th_date: '追加日'
  },
  ko: {
    ctx_refresh_url: 'URL 새로 고침',
    refresh_modal_title: '다운로드 URL 새로 고침',
    refresh_modal_desc: '이 다운로드의 URL이 만료되었습니다. 다운로드를 다시 시작하려면 새 URL을 입력하세요.',
    refresh_modal_label: '새 URL',
    refresh_modal_btn: 'URL 업데이트',
    opt_default: '기본',
    opt_alt_default: 'Alt (기본)',
    st_canceled: '취소됨',
    th_date: '추가된 날짜'
  },
  'pt-BR': {
    ctx_refresh_url: 'Atualizar URL',
    refresh_modal_title: 'Atualizar URL de download',
    refresh_modal_desc: 'O URL deste download expirou. Insira o novo URL para retomar o download.',
    refresh_modal_label: 'Novo URL',
    refresh_modal_btn: 'Atualizar URL',
    opt_default: 'padrão',
    opt_alt_default: 'Alt (padrão)',
    st_canceled: 'Cancelado',
    th_date: 'Data de Adição'
  },
  ru: {
    ctx_refresh_url: 'Обновить URL',
    refresh_modal_title: 'Обновить URL скачивания',
    refresh_modal_desc: 'Срок действия URL-адреса для этого скачивания истек. Пожалуйста, введите новый URL-адрес, чтобы возобновить скачивание.',
    refresh_modal_label: 'Новый URL',
    refresh_modal_btn: 'Обновить URL',
    opt_default: 'по умолчанию',
    opt_alt_default: 'Alt (по умолчанию)',
    st_canceled: 'Отменено',
    th_date: 'Дата добавления'
  },
  tr: {
    ctx_refresh_url: 'Bağlantıyı Yenile',
    refresh_modal_title: 'İndirme Bağlantısını Yenile',
    refresh_modal_desc: 'Bu indirme işleminin bağlantı süresi dolmuş. İndirmeye devam etmek için lütfen yeni bağlantıyı girin.',
    refresh_modal_label: 'Yeni Bağlantı',
    refresh_modal_btn: 'Bağlantıyı Güncelle',
    opt_default: 'varsayılan',
    opt_alt_default: 'Alt (varsayılan)',
    st_canceled: 'İptal Edildi',
    th_date: 'Eklenme Tarihi'
  },
  vi: {
    ctx_refresh_url: 'Làm mới URL',
    refresh_modal_title: 'Làm mới URL tải xuống',
    refresh_modal_desc: 'URL cho bản tải xuống này đã hết hạn. Vui lòng nhập URL mới để tiếp tục tải xuống.',
    refresh_modal_label: 'URL mới',
    refresh_modal_btn: 'Cập nhật URL',
    opt_default: 'mặc định',
    opt_alt_default: 'Alt (mặc định)',
    st_canceled: 'Đã hủy',
    th_date: 'Ngày thêm'
  },
  'zh-CN': {
    ctx_refresh_url: '刷新网址',
    refresh_modal_title: '刷新下载网址',
    refresh_modal_desc: '此下载的网址已过期。请输入新网址以恢复下载。',
    refresh_modal_label: '新网址',
    refresh_modal_btn: '更新网址',
    opt_default: '默认',
    opt_alt_default: 'Alt（默认）',
    st_canceled: '已取消',
    th_date: '添加日期'
  }
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
    // Escape single quotes for Regex replacement
    let val = langObj[key].replace(/'/g, "\\'");
    let regex = new RegExp(`^\\s*${key}\\s*:\\s*(['"\`]).*?\\1,`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, `  ${key}: '${val}',`);
    } else {
        // if missing append
        content = content.replace(/(export default \{|const [a-zA-Z]+ = \{)/, `$1\n  ${key}: '${val}',`);
    }
  });

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fully translated ' + file);
});
