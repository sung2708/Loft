export type Locale = "vi" | "en";

export interface TranslationDictionary {
  common: {
    signIn: string;
    signOut: string;
    cancel: string;
    continue: string;
    create: string;
    join: string;
    close: string;
    or: string;
    active: string;
    back: string;
    loading: string;
  };
  lobby: {
    constellation: string;
    heroTitle: string;
    heroSubtitle: string;
    inputPlaceholder: string;
    enterHint: string;
    roomTypeHint: string;
    joinRoom: string;
    connecting: string;
    continueWithGoogle: string;
    authHelper: string;
    wantYourOwnSpace: string;
    createRoom: string;
    recentRooms: string;
    guestAccessEnabled: string;
    signInRequired: string;
    guestInstantPass: string;
    authenticatedAccess: string;
    roomNotFound: string;
    enterValidRoom: string;
    featureWebRTC: string;
    featureSessions: string;
    featureNoInstall: string;
    footerText: string;
    footerVersion: string;
    roomsHostBadge: string;
  };
  account: {
    yourRooms: string;
    createRoom: string;
    appearance: string;
    language: string;
    signOut: string;
    guestUser: string;
  };
  createModal: {
    title: string;
    nameLabel: string;
    nameRequired: string;
    namePlaceholder: string;
    allowGuests: string;
    allowGuestsDesc: string;
    cancel: string;
    createRoom: string;
  };
  mediaQueue: {
    sharedQueue: string;
    nowPlaying: string;
    nextUp: string;
    pasteUrl: string;
    add: string;
    adding: string;
    emptyQueue: string;
    noMedia: string;
    addedBy: string;
    shuffle: string;
    repeat: string;
    clearList: string;
    enableAudio: string;
    play: string;
    pause: string;
    previous: string;
    next: string;
    volume: string;
    fullscreen: string;
    openInYouTube: string;
    remove: string;
  };
  roomModeration: {
    participantActions: string;
    makeHost: string;
    removeParticipant: string;
    temporaryBan: string;
    temporaryBanConfirmation: string;
  };
  roomSocial: {
    socialActions: string;
    wave: string;
    raiseHand: string;
    lowerHand: string;
    handRaised: string;
    soundEffects: string;
    roomSounds: string;
    effectsVolume: string;
  };
  roomAtmosphere?: {
    atmosphere: string;
    accent: string;
    adaptMedia: string;
    minimal: string;
    ambient: string;
    focus: string;
    party: string;
    blue: string;
    purple: string;
    green: string;
    orange: string;
    rose: string;
    invalidAppearance: string;
    updateFailed: string;
  };
}
