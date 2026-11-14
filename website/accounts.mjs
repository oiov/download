// 公开页面的九语言账户入口；额度与价格始终从服务端读取，不写死营销数字。
export const accountCopy = [
  ['Account', 'Plans & limits', 'A simple start. Room to grow.', 'Start anonymously with public links. Sign in to keep access to claimed tasks across devices, see your usage, or join the API beta.', 'Explore plans', 'Developer API', 'An account does not unlock restricted sources or extend file retention.'],
  ['账户', '套餐与额度', '匿名开始，按需扩展。', '用公开链接匿名开始。登录后跨设备访问认领的任务、查看用量，或申请 API 内测。', '查看套餐', '开发者 API', '账户不会解除来源限制，也不会延长文件有效期。'],
  ['Cuenta', 'Planes y límites', 'Empieza fácil. Crece a tu ritmo.', 'Empieza sin cuenta con enlaces públicos. Inicia sesión para acceder a las tareas reclamadas desde otros dispositivos, ver tu uso o participar en la beta de la API.', 'Ver planes', 'API para desarrolladores', 'Una cuenta no desbloquea fuentes restringidas ni amplía la conservación de archivos.'],
  ['Conta', 'Planos e limites', 'Comece sem conta. Amplie quando precisar.', 'Use links públicos sem cadastro. Entre para acessar tarefas vinculadas em outros dispositivos, consultar seu uso ou participar da versão beta da API.', 'Ver planos', 'API para desenvolvedores', 'Uma conta não desbloqueia fontes restritas nem prolonga a validade dos arquivos.'],
  ['Konto', 'Tarife & Limits', 'Einfach starten. Bei Bedarf erweitern.', 'Starte ohne Konto mit öffentlichen Links. Melde dich an, um übernommene Aufgaben geräteübergreifend aufzurufen, die Nutzung zu sehen oder an der API-Beta teilzunehmen.', 'Tarife ansehen', 'Entwickler-API', 'Ein Konto hebt keine Quellbeschränkungen auf und verlängert nicht die Aufbewahrung.'],
  ['Compte', 'Offres et limites', 'Commencez simplement. Évoluez à votre rythme.', 'Utilisez des liens publics sans compte. Connectez-vous pour retrouver les tâches rattachées sur vos appareils, consulter votre utilisation ou participer à la bêta API.', 'Voir les offres', 'API développeur', 'Un compte ne débloque pas les sources restreintes et ne prolonge pas la conservation des fichiers.'],
  ['アカウント', 'プランと上限', '登録なしで開始。必要に応じて拡張。', '公開リンクで登録なしに開始できます。ログインすると、引き継いだタスクを別の端末で確認し、使用量の確認や API ベータへの参加ができます。', 'プランを見る', '開発者 API', 'アカウントは配信元の制限を解除せず、ファイルの保存期間も延長しません。'],
  ['계정', '요금제 및 한도', '가입 없이 시작하고 필요할 때 확장하세요.', '공개 링크로 가입 없이 시작하세요. 로그인하면 연결한 작업을 다른 기기에서 확인하고 사용량을 보거나 API 베타에 참여할 수 있습니다.', '요금제 보기', '개발자 API', '계정은 원본 사이트의 제한을 해제하거나 파일 보관 기간을 늘리지 않습니다.'],
  ['Аккаунт', 'Тарифы и лимиты', 'Простой старт. Больше возможностей по мере роста.', 'Начните без регистрации с общедоступных ссылок. Войдите, чтобы открывать привязанные задачи на других устройствах, следить за использованием или участвовать в бета-тесте API.', 'Посмотреть тарифы', 'API для разработчиков', 'Аккаунт не снимает ограничения источников и не продлевает срок хранения файлов.'],
]
const loginCopy = [
  ['Sign in', 'Dashboard', 'Welcome to Keep Video', 'Sign in to manage your downloads, usage and subscription.', 'Continue with Google', 'Continue without signing in', 'Close', 'Sign-in is currently unavailable. Please try again later.', 'Could not sign in. Please try again.'],
  ['登录', '控制面板', '登录 Keep Video', '登录后管理下载任务、查看用量和订阅。', '使用 Google 登录', '继续匿名使用', '关闭', '登录暂不可用，请稍后再试。', '登录失败，请重试。'],
  ['Iniciar sesión', 'Panel', 'Accede a Keep Video', 'Gestiona tus descargas, uso y suscripción.', 'Continuar con Google', 'Continuar sin iniciar sesión', 'Cerrar', 'El inicio de sesión no está disponible. Inténtalo más tarde.', 'No se pudo iniciar sesión. Inténtalo de nuevo.'],
  ['Entrar', 'Painel', 'Entre no Keep Video', 'Gerencie seus downloads, uso e assinatura.', 'Continuar com o Google', 'Continuar sem entrar', 'Fechar', 'O login está indisponível. Tente mais tarde.', 'Não foi possível entrar. Tente novamente.'],
  ['Anmelden', 'Dashboard', 'Bei Keep Video anmelden', 'Verwalte Downloads, Nutzung und Abonnement.', 'Mit Google fortfahren', 'Ohne Anmeldung fortfahren', 'Schließen', 'Die Anmeldung ist derzeit nicht verfügbar. Versuche es später erneut.', 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'],
  ['Connexion', 'Tableau de bord', 'Se connecter à Keep Video', 'Gérez vos téléchargements, votre utilisation et votre abonnement.', 'Continuer avec Google', 'Continuer sans connexion', 'Fermer', 'La connexion est indisponible. Réessayez plus tard.', 'Échec de la connexion. Réessayez.'],
  ['ログイン', 'ダッシュボード', 'Keep Video にログイン', 'ダウンロード、使用量、サブスクリプションを管理できます。', 'Google で続行', 'ログインせずに続ける', '閉じる', '現在ログインできません。後でもう一度お試しください。', 'ログインできませんでした。もう一度お試しください。'],
  ['로그인', '대시보드', 'Keep Video 로그인', '다운로드, 사용량 및 구독을 관리하세요.', 'Google로 계속하기', '로그인 없이 계속하기', '닫기', '지금은 로그인할 수 없습니다. 나중에 다시 시도하세요.', '로그인하지 못했습니다. 다시 시도하세요.'],
  ['Войти', 'Панель', 'Войти в Keep Video', 'Управляйте загрузками, использованием и подпиской.', 'Продолжить с Google', 'Продолжить без входа', 'Закрыть', 'Вход временно недоступен. Повторите позже.', 'Не удалось войти. Повторите попытку.'],
]
export function accountLinks(lang) {
  const text = loginCopy[lang]
  return `<button type="button" class="account-link" data-login-trigger data-dashboard-label="${text[1]}">${text[0]}</button>`
}
export function loginDialog(lang) {
  const text = loginCopy[lang], suffix = lang === 1 ? '?lang=zh' : '?lang=en'
  return `<dialog class="login-dialog" aria-labelledby="login-title" aria-describedby="login-description" data-dashboard="/dashboard${suffix}" data-unavailable="${text[7]}" data-error="${text[8]}"><button type="button" class="login-close" data-login-close aria-label="${text[6]}">×</button><div class="login-mark" aria-hidden="true">↗</div><h2 id="login-title">${text[2]}</h2><p id="login-description">${text[3]}</p><form action="/account/login${suffix}" method="post"><button type="submit" class="login-google"><img src="/assets/brand/google.svg" width="20" height="20" alt="">${text[4]}</button></form><p class="login-error" role="alert" hidden></p><button type="button" class="login-guest" data-login-close>${text[5]}</button></dialog>`
}
export function accountSection(lang) {
  const text = accountCopy[lang], suffix = lang === 1 ? '?lang=zh' : ''
  return `<section class="account-section section"><div><h2>${text[2]}</h2><p>${text[3]}</p><p class="fineprint">${text[6]}</p></div><div class="account-actions"><a class="button" href="/pricing${suffix}">${text[4]} ↗</a><a class="text-link" href="/developers${suffix}">${text[5]} ↗</a></div></section>`
}
