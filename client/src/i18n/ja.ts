export const ja = {
  header: {
    title: 'Sumica AI Studio 🎨⚡️',
    subtitle: 'Creative Image Lab',
    cloudSaving: 'クラウド保存 ☁️',
    localSaving: 'ローカル保存 📁',
    userLabel: 'ユーザー',
    signOut: 'ログアウト',
    signIn: 'Googleでログイン',
    signInFailed: (msg: string) => `サインインに失敗しました: ${msg}`,
    serviceChecking: (label: string) => `${label} 確認中…`,
    serviceConnected: (label: string, detail?: string) =>
      `${label} 接続中${detail ? ` (${detail})` : ''}`,
    serviceDisconnected: (label: string) => `${label} 未接続`,
    lmStudioLabel: 'LM Studio',
    sdLabel: 'SD',
    notifyEnable: '通知を有効化',
    notifyDisable: '通知を無効化',
  },
};
