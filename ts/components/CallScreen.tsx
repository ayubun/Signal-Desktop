// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { isEqual, noop } from 'lodash';
import classNames from 'classnames';
import type { VideoFrameSource } from '@signalapp/ringrtc';
import type {
  ActiveCallStateType,
  SendGroupCallReactionType,
  SetLocalAudioType,
  SetLocalPreviewType,
  SetLocalVideoType,
  SetRendererCanvasType,
} from '../state/ducks/calling';
import { Avatar, AvatarSize } from './Avatar';
import { CallingHeader, getCallViewIconClassname } from './CallingHeader';
import { CallingPreCallInfo, RingMode } from './CallingPreCallInfo';
import { CallingButton, CallingButtonType } from './CallingButton';
import { Button, ButtonVariant } from './Button';
import { TooltipPlacement } from './Tooltip';
import { CallBackgroundBlur } from './CallBackgroundBlur';
import type {
  ActiveCallType,
  ActiveCallReactionsType,
  ConversationsByDemuxIdType,
  GroupCallVideoRequest,
  PresentedSource,
} from '../types/Calling';
import {
  CALLING_REACTIONS_LIFETIME,
  CallMode,
  CallViewMode,
  CallState,
  GroupCallConnectionState,
  GroupCallJoinState,
} from '../types/Calling';
import { AvatarColors } from '../types/Colors';
import type { ConversationType } from '../state/ducks/conversations';
import {
  CallingButtonToastsContainer,
  useScreenSharingStoppedToast,
} from './CallingToastManager';
import { DirectCallRemoteParticipant } from './DirectCallRemoteParticipant';
import { GroupCallRemoteParticipants } from './GroupCallRemoteParticipants';
import { CallParticipantCount } from './CallParticipantCount';
import type { LocalizerType } from '../types/Util';
import { NeedsScreenRecordingPermissionsModal } from './NeedsScreenRecordingPermissionsModal';
import { missingCaseError } from '../util/missingCaseError';
import * as KeyboardLayout from '../services/keyboardLayout';
import {
  usePresenter,
  useActivateSpeakerViewOnPresenting,
} from '../hooks/useActivateSpeakerViewOnPresenting';
import {
  CallingAudioIndicator,
  SPEAKING_LINGER_MS,
} from './CallingAudioIndicator';
import {
  useActiveCallShortcuts,
  useKeyboardShortcuts,
} from '../hooks/useKeyboardShortcuts';
import { useValueAtFixedRate } from '../hooks/useValueAtFixedRate';
import { isReconnecting as callingIsReconnecting } from '../util/callingIsReconnecting';
import { usePrevious } from '../hooks/usePrevious';
import {
  CallingToastProvider,
  PersistentCallingToast,
  useCallingToasts,
} from './CallingToast';
import { Spinner } from './Spinner';
import { handleOutsideClick } from '../util/handleOutsideClick';
import type { Props as ReactionPickerProps } from './conversation/ReactionPicker';
import type { SmartReactionPicker } from '../state/smart/ReactionPicker';
import { Emoji } from './emoji/Emoji';

export type PropsType = {
  activeCall: ActiveCallType;
  getGroupCallVideoFrameSource: (demuxId: number) => VideoFrameSource;
  getPresentingSources: () => void;
  groupMembers?: Array<Pick<ConversationType, 'id' | 'firstName' | 'title'>>;
  hangUpActiveCall: (reason: string) => void;
  i18n: LocalizerType;
  isGroupCallReactionsEnabled: boolean;
  me: ConversationType;
  openSystemPreferencesAction: () => unknown;
  renderReactionPicker: (
    props: React.ComponentProps<typeof SmartReactionPicker>
  ) => JSX.Element;
  sendGroupCallReaction: (payload: SendGroupCallReactionType) => void;
  setGroupCallVideoRequest: (
    _: Array<GroupCallVideoRequest>,
    speakerHeight: number
  ) => void;
  setLocalAudio: (_: SetLocalAudioType) => void;
  setLocalVideo: (_: SetLocalVideoType) => void;
  setLocalPreview: (_: SetLocalPreviewType) => void;
  setPresenting: (_?: PresentedSource) => void;
  setRendererCanvas: (_: SetRendererCanvasType) => void;
  stickyControls: boolean;
  switchToPresentationView: () => void;
  switchFromPresentationView: () => void;
  toggleParticipants: () => void;
  togglePip: () => void;
  toggleScreenRecordingPermissionsDialog: () => unknown;
  toggleSettings: () => void;
  changeCallView: (mode: CallViewMode) => void;
} & Pick<ReactionPickerProps, 'renderEmojiPicker'>;

export const isInSpeakerView = (
  call: Pick<ActiveCallStateType, 'viewMode'> | undefined
): boolean => {
  return Boolean(
    call?.viewMode === CallViewMode.Presentation ||
      call?.viewMode === CallViewMode.Speaker
  );
};

export const CALL_REACTION_EMOJI = [
  '❤️',
  '👍',
  '👋',
  '👏',
  '🎉',
  '😂',
] as const;

const REACTIONS_TOASTS_TRANSITION_FROM = {
  opacity: 0,
};

function CallDuration({
  joinedAt,
}: {
  joinedAt: number | null;
}): JSX.Element | null {
  const [acceptedDuration, setAcceptedDuration] = useState<
    number | undefined
  >();

  useEffect(() => {
    if (joinedAt == null) {
      return noop;
    }
    // It's really jumpy with a value of 500ms.
    const interval = setInterval(() => {
      setAcceptedDuration(Date.now() - joinedAt);
    }, 100);
    return clearInterval.bind(null, interval);
  }, [joinedAt]);

  if (acceptedDuration) {
    return <>{renderDuration(acceptedDuration)}</>;
  }
  return null;
}

export function CallScreen({
  activeCall,
  changeCallView,
  getGroupCallVideoFrameSource,
  getPresentingSources,
  groupMembers,
  hangUpActiveCall,
  i18n,
  isGroupCallReactionsEnabled,
  me,
  openSystemPreferencesAction,
  renderEmojiPicker,
  renderReactionPicker,
  setGroupCallVideoRequest,
  sendGroupCallReaction,
  setLocalAudio,
  setLocalVideo,
  setLocalPreview,
  setPresenting,
  setRendererCanvas,
  stickyControls,
  switchToPresentationView,
  switchFromPresentationView,
  toggleParticipants,
  togglePip,
  toggleScreenRecordingPermissionsDialog,
  toggleSettings,
}: PropsType): JSX.Element {
  const {
    conversation,
    hasLocalAudio,
    hasLocalVideo,
    localAudioLevel,
    presentingSource,
    remoteParticipants,
    showNeedsScreenRecordingPermissionsWarning,
    reactions,
  } = activeCall;

  const isSpeaking = useValueAtFixedRate(
    localAudioLevel > 0,
    SPEAKING_LINGER_MS
  );

  useActivateSpeakerViewOnPresenting({
    remoteParticipants,
    switchToPresentationView,
    switchFromPresentationView,
  });

  const activeCallShortcuts = useActiveCallShortcuts(hangUpActiveCall);
  useKeyboardShortcuts(activeCallShortcuts);

  const toggleAudio = useCallback(() => {
    setLocalAudio({
      enabled: !hasLocalAudio,
    });
  }, [setLocalAudio, hasLocalAudio]);

  const toggleVideo = useCallback(() => {
    setLocalVideo({
      enabled: !hasLocalVideo,
    });
  }, [setLocalVideo, hasLocalVideo]);

  const togglePresenting = useCallback(() => {
    if (presentingSource) {
      setPresenting();
    } else {
      getPresentingSources();
    }
  }, [getPresentingSources, presentingSource, setPresenting]);

  const hangUp = useCallback(() => {
    hangUpActiveCall('button click');
  }, [hangUpActiveCall]);

  const moreOptionsMenuRef = React.useRef<null | HTMLDivElement>(null);
  const moreOptionsButtonRef = React.useRef<null | HTMLDivElement>(null);
  const reactionPickerRef = React.useRef<null | HTMLDivElement>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const toggleMoreOptions = useCallback(() => {
    setShowMoreOptions(prevValue => !prevValue);
  }, []);

  const [controlsHover, setControlsHover] = useState(false);

  const onControlsMouseEnter = useCallback(() => {
    setControlsHover(true);
  }, [setControlsHover]);

  const onControlsMouseLeave = useCallback(() => {
    setControlsHover(false);
  }, [setControlsHover]);

  const [showControls, setShowControls] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setLocalPreview({ element: localVideoRef });
    return () => {
      setLocalPreview({ element: undefined });
    };
  }, [setLocalPreview, setRendererCanvas]);

  useEffect(() => {
    if (!showControls || showMoreOptions || stickyControls || controlsHover) {
      return noop;
    }
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 5000);
    return clearTimeout.bind(null, timer);
  }, [showControls, showMoreOptions, stickyControls, controlsHover]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      let eventHandled = false;

      const key = KeyboardLayout.lookup(event);

      if (event.shiftKey && (key === 'V' || key === 'v')) {
        toggleVideo();
        eventHandled = true;
      } else if (event.shiftKey && (key === 'M' || key === 'm')) {
        toggleAudio();
        eventHandled = true;
      }

      if (eventHandled) {
        event.preventDefault();
        event.stopPropagation();
        setShowControls(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleAudio, toggleVideo]);

  useEffect(() => {
    if (!showMoreOptions) {
      return noop;
    }
    return handleOutsideClick(
      () => {
        setShowMoreOptions(false);
        return true;
      },
      {
        containerElements: [moreOptionsButtonRef, moreOptionsMenuRef],
        name: 'CallScreen.moreOptions',
      }
    );
  }, [showMoreOptions]);

  useScreenSharingStoppedToast({ activeCall, i18n });
  useViewModeChangedToast({ activeCall, i18n });

  const currentPresenter = remoteParticipants.find(
    participant => participant.presenting
  );

  const hasRemoteVideo = remoteParticipants.some(
    remoteParticipant => remoteParticipant.hasRemoteVideo
  );

  const isSendingVideo = hasLocalVideo || presentingSource;
  const isReconnecting: boolean = callingIsReconnecting(activeCall);

  let isRinging: boolean;
  let hasCallStarted: boolean;
  let isConnected: boolean;
  let participantCount: number;
  let remoteParticipantsElement: ReactNode;
  let conversationsByDemuxId: ConversationsByDemuxIdType;
  let localDemuxId: number | undefined;

  switch (activeCall.callMode) {
    case CallMode.Direct: {
      isRinging =
        activeCall.callState === CallState.Prering ||
        activeCall.callState === CallState.Ringing;
      hasCallStarted = !isRinging;
      isConnected = activeCall.callState === CallState.Accepted;
      participantCount = isConnected ? 2 : 0;
      conversationsByDemuxId = new Map();
      remoteParticipantsElement = hasCallStarted ? (
        <DirectCallRemoteParticipant
          conversation={conversation}
          hasRemoteVideo={hasRemoteVideo}
          i18n={i18n}
          isReconnecting={isReconnecting}
          setRendererCanvas={setRendererCanvas}
        />
      ) : (
        <div className="module-ongoing-call__direct-call-ringing-spacer" />
      );
      break;
    }
    case CallMode.Group:
      isRinging =
        activeCall.outgoingRing &&
        !activeCall.remoteParticipants.length &&
        !(groupMembers?.length === 1 && groupMembers[0].id === me.id);
      hasCallStarted = activeCall.joinState !== GroupCallJoinState.NotJoined;
      participantCount = activeCall.remoteParticipants.length + 1;
      conversationsByDemuxId = activeCall.conversationsByDemuxId;
      localDemuxId = activeCall.localDemuxId;

      isConnected =
        activeCall.connectionState === GroupCallConnectionState.Connected;
      remoteParticipantsElement = (
        <GroupCallRemoteParticipants
          callViewMode={activeCall.viewMode}
          getGroupCallVideoFrameSource={getGroupCallVideoFrameSource}
          i18n={i18n}
          remoteParticipants={activeCall.remoteParticipants}
          setGroupCallVideoRequest={setGroupCallVideoRequest}
          remoteAudioLevels={activeCall.remoteAudioLevels}
          isCallReconnecting={isReconnecting}
        />
      );
      break;
    default:
      throw missingCaseError(activeCall);
  }

  let lonelyInCallNode: ReactNode;
  let localPreviewNode: ReactNode;

  const isLonelyInCall = !activeCall.remoteParticipants.length;

  if (isLonelyInCall) {
    lonelyInCallNode = (
      <div
        className={classNames(
          'module-ongoing-call__local-preview-fullsize',
          presentingSource &&
            'module-ongoing-call__local-preview-fullsize--presenting'
        )}
      >
        {isSendingVideo ? (
          <video ref={localVideoRef} autoPlay />
        ) : (
          <CallBackgroundBlur avatarPath={me.avatarPath} color={me.color}>
            <div className="module-calling__spacer module-calling__camera-is-off-spacer" />
            <div className="module-calling__camera-is-off">
              {i18n('icu:calling__your-video-is-off')}
            </div>
          </CallBackgroundBlur>
        )}
      </div>
    );
  } else {
    localPreviewNode = isSendingVideo ? (
      <video
        className={classNames(
          'module-ongoing-call__footer__local-preview__video',
          presentingSource &&
            'module-ongoing-call__footer__local-preview__video--presenting'
        )}
        ref={localVideoRef}
        autoPlay
      />
    ) : (
      <CallBackgroundBlur avatarPath={me.avatarPath} color={me.color}>
        <Avatar
          acceptedMessageRequest
          avatarPath={me.avatarPath}
          badge={undefined}
          color={me.color || AvatarColors[0]}
          noteToSelf={false}
          conversationType="direct"
          i18n={i18n}
          isMe
          phoneNumber={me.phoneNumber}
          profileName={me.profileName}
          title={me.title}
          // See comment above about `sharedGroupNames`.
          sharedGroupNames={[]}
          size={AvatarSize.FORTY}
        />
      </CallBackgroundBlur>
    );
  }

  let videoButtonType: CallingButtonType;
  if (presentingSource) {
    videoButtonType = CallingButtonType.VIDEO_DISABLED;
  } else if (hasLocalVideo) {
    videoButtonType = CallingButtonType.VIDEO_ON;
  } else {
    videoButtonType = CallingButtonType.VIDEO_OFF;
  }

  const audioButtonType = hasLocalAudio
    ? CallingButtonType.AUDIO_ON
    : CallingButtonType.AUDIO_OFF;

  const isAudioOnly = !hasLocalVideo && !hasRemoteVideo;

  const controlsFadedOut = !showControls && !isAudioOnly && isConnected;
  const controlsFadeClass = classNames({
    'module-ongoing-call__controls--fadeIn':
      (showControls || isAudioOnly) && !isConnected,
    'module-ongoing-call__controls--fadeOut': controlsFadedOut,
  });

  const isGroupCall = activeCall.callMode === CallMode.Group;
  const isMoreOptionsButtonEnabled = isGroupCall && isGroupCallReactionsEnabled;

  let presentingButtonType: CallingButtonType;
  if (presentingSource) {
    presentingButtonType = CallingButtonType.PRESENTING_ON;
  } else if (currentPresenter) {
    presentingButtonType = CallingButtonType.PRESENTING_DISABLED;
  } else {
    presentingButtonType = CallingButtonType.PRESENTING_OFF;
  }

  const callStatus: ReactNode | string = React.useMemo(() => {
    if (isRinging) {
      return i18n('icu:outgoingCallRinging');
    }
    if (isReconnecting) {
      return i18n('icu:callReconnecting');
    }
    if (isGroupCall) {
      return (
        <CallParticipantCount
          i18n={i18n}
          participantCount={participantCount}
          toggleParticipants={toggleParticipants}
        />
      );
    }
    // joinedAt is only available for direct calls
    if (isConnected) {
      return <CallDuration joinedAt={activeCall.joinedAt} />;
    }
    if (hasLocalVideo) {
      return i18n('icu:ContactListItem__menu__video-call');
    }
    if (hasLocalAudio) {
      return i18n('icu:CallControls__InfoDisplay--audio-call');
    }
    return null;
  }, [
    i18n,
    isRinging,
    isConnected,
    activeCall.joinedAt,
    isReconnecting,
    isGroupCall,
    participantCount,
    hasLocalVideo,
    hasLocalAudio,
    toggleParticipants,
  ]);

  return (
    <div
      className={classNames(
        'module-calling__container',
        `module-ongoing-call__container--${getCallModeClassSuffix(
          activeCall.callMode
        )}`,
        `module-ongoing-call__container--${
          hasCallStarted ? 'call-started' : 'call-not-started'
        }`,
        { 'module-ongoing-call__container--hide-controls': !showControls },
        {
          'module-ongoing-call__container--controls-faded-out':
            controlsFadedOut,
        }
      )}
      onFocus={() => {
        setShowControls(true);
      }}
      onMouseMove={() => {
        setShowControls(true);
      }}
      role="group"
    >
      {isReconnecting ? (
        <PersistentCallingToast>
          <span className="CallingToast__reconnecting">
            <Spinner svgSize="small" size="16px" />
            {i18n('icu:callReconnecting')}
          </span>
        </PersistentCallingToast>
      ) : null}

      {isLonelyInCall && !isRinging ? (
        <PersistentCallingToast>
          {i18n('icu:calling__in-this-call--zero')}
        </PersistentCallingToast>
      ) : null}

      {currentPresenter ? (
        <PersistentCallingToast>
          {i18n('icu:calling__presenting--person-ongoing', {
            name: currentPresenter.title,
          })}
        </PersistentCallingToast>
      ) : null}

      {showNeedsScreenRecordingPermissionsWarning ? (
        <NeedsScreenRecordingPermissionsModal
          toggleScreenRecordingPermissionsDialog={
            toggleScreenRecordingPermissionsDialog
          }
          i18n={i18n}
          openSystemPreferencesAction={openSystemPreferencesAction}
        />
      ) : null}
      <div className={controlsFadeClass}>
        <CallingHeader
          callViewMode={activeCall.viewMode}
          changeCallView={changeCallView}
          i18n={i18n}
          isGroupCall={isGroupCall}
          participantCount={participantCount}
          togglePip={togglePip}
          toggleSettings={toggleSettings}
        />
      </div>
      {isRinging && (
        <>
          <div className="module-CallingPreCallInfo-spacer " />
          <CallingPreCallInfo
            conversation={conversation}
            groupMembers={groupMembers}
            i18n={i18n}
            me={me}
            ringMode={RingMode.IsRinging}
          />
        </>
      )}
      {remoteParticipantsElement}
      {lonelyInCallNode}
      <CallingReactionsToastsContainer
        reactions={reactions}
        conversationsByDemuxId={conversationsByDemuxId}
        localDemuxId={localDemuxId}
        i18n={i18n}
      />
      <div className="module-ongoing-call__footer">
        <div className="module-calling__spacer CallControls__OuterSpacer" />
        <div
          className={classNames(
            'CallControls',
            'module-ongoing-call__footer__actions',
            controlsFadeClass
          )}
        >
          <div className="CallControls__InfoDisplay">
            <div className="CallControls__CallTitle">{conversation.title}</div>
            <div className="CallControls__Status">{callStatus}</div>
          </div>

          <CallingButtonToastsContainer
            hasLocalAudio={hasLocalAudio}
            outgoingRing={undefined}
            i18n={i18n}
          />

          {showMoreOptions && (
            <div className="CallControls__MoreOptionsContainer">
              <div
                className="CallControls__MoreOptionsMenu"
                ref={moreOptionsMenuRef}
              >
                {renderReactionPicker({
                  ref: reactionPickerRef,
                  onClose: () => setShowMoreOptions(false),
                  onPick: emoji => {
                    setShowMoreOptions(false);
                    sendGroupCallReaction({
                      conversationId: conversation.id,
                      value: emoji,
                    });
                  },
                  isCustomizePreferredReactionsHidden: true,
                  preferredReactionEmoji: CALL_REACTION_EMOJI,
                  renderEmojiPicker,
                })}
              </div>
            </div>
          )}

          <div className="CallControls__ButtonContainer">
            <CallingButton
              buttonType={presentingButtonType}
              i18n={i18n}
              onMouseEnter={onControlsMouseEnter}
              onMouseLeave={onControlsMouseLeave}
              onClick={togglePresenting}
              tooltipDirection={TooltipPlacement.Top}
            />
            <CallingButton
              buttonType={videoButtonType}
              i18n={i18n}
              onMouseEnter={onControlsMouseEnter}
              onMouseLeave={onControlsMouseLeave}
              onClick={toggleVideo}
              tooltipDirection={TooltipPlacement.Top}
            />
            <CallingButton
              buttonType={audioButtonType}
              i18n={i18n}
              onMouseEnter={onControlsMouseEnter}
              onMouseLeave={onControlsMouseLeave}
              onClick={toggleAudio}
              tooltipDirection={TooltipPlacement.Top}
            />
            {isMoreOptionsButtonEnabled && (
              <div
                className="CallControls__MoreOptionsButtonContainer"
                ref={moreOptionsButtonRef}
              >
                <CallingButton
                  buttonType={CallingButtonType.MORE_OPTIONS}
                  i18n={i18n}
                  onMouseEnter={onControlsMouseEnter}
                  onMouseLeave={onControlsMouseLeave}
                  onClick={toggleMoreOptions}
                  tooltipDirection={TooltipPlacement.Top}
                />
              </div>
            )}
          </div>
          <div
            className="CallControls__JoinLeaveButtonContainer"
            onMouseEnter={onControlsMouseEnter}
            onMouseLeave={onControlsMouseLeave}
          >
            <Button
              className="CallControls__JoinLeaveButton CallControls__JoinLeaveButton--hangup"
              onClick={hangUp}
              variant={ButtonVariant.Destructive}
            >
              {isGroupCall
                ? i18n('icu:CallControls__JoinLeaveButton--hangup-group')
                : i18n('icu:CallControls__JoinLeaveButton--hangup-1-1')}
            </Button>
          </div>
        </div>
        {localPreviewNode ? (
          <div className="module-ongoing-call__footer__local-preview module-ongoing-call__footer__local-preview--active">
            {localPreviewNode}
            {!isSendingVideo && (
              <div className="CallingStatusIndicator CallingStatusIndicator--Video" />
            )}
            <CallingAudioIndicator
              hasAudio={hasLocalAudio}
              audioLevel={localAudioLevel}
              shouldShowSpeaking={isSpeaking}
            />
          </div>
        ) : (
          <div className="module-ongoing-call__footer__local-preview" />
        )}
      </div>
    </div>
  );
}

function getCallModeClassSuffix(
  callMode: CallMode.Direct | CallMode.Group
): string {
  switch (callMode) {
    case CallMode.Direct:
      return 'direct';
    case CallMode.Group:
      return 'group';
    default:
      throw missingCaseError(callMode);
  }
}

function renderDuration(ms: number): string {
  const secs = Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor((ms / 60000) % 60)
    .toString()
    .padStart(2, '0');
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) {
    return `${hours}:${mins}:${secs}`;
  }
  return `${mins}:${secs}`;
}

function useViewModeChangedToast({
  activeCall,
  i18n,
}: {
  activeCall: ActiveCallType;
  i18n: LocalizerType;
}): void {
  const { viewMode } = activeCall;
  const previousViewMode = usePrevious(viewMode, viewMode);
  const presenterAci = usePresenter(activeCall.remoteParticipants);

  const VIEW_MODE_CHANGED_TOAST_KEY = 'view-mode-changed';
  const { showToast, hideToast } = useCallingToasts();

  useEffect(() => {
    if (viewMode !== previousViewMode) {
      if (
        // If this is an automated change to presentation mode, don't show toast
        viewMode === CallViewMode.Presentation ||
        // if this is an automated change away from presentation mode, don't show toast
        (previousViewMode === CallViewMode.Presentation && !presenterAci)
      ) {
        return;
      }

      hideToast(VIEW_MODE_CHANGED_TOAST_KEY);
      showToast({
        key: VIEW_MODE_CHANGED_TOAST_KEY,
        content: (
          <div className="CallingToast__viewChanged">
            <span
              className={classNames(
                'CallingToast__viewChanged__icon',
                getCallViewIconClassname(viewMode)
              )}
            />
            {i18n('icu:calling__view_mode--updated')}
          </div>
        ),
        autoClose: true,
      });
    }
  }, [
    showToast,
    hideToast,
    i18n,
    activeCall,
    viewMode,
    previousViewMode,
    presenterAci,
  ]);
}

type CallingReactionsToastsType = {
  reactions: ActiveCallReactionsType | undefined;
  conversationsByDemuxId: Map<number, ConversationType>;
  localDemuxId: number | undefined;
  i18n: LocalizerType;
};

function useReactionsToast(props: CallingReactionsToastsType): void {
  const { reactions, conversationsByDemuxId, localDemuxId, i18n } = props;
  const [previousReactions, setPreviousReactions] = React.useState<
    ActiveCallReactionsType | undefined
  >(undefined);
  const { showToast } = useCallingToasts();

  useEffect(() => {
    setPreviousReactions(reactions);
  }, [reactions]);

  useEffect(() => {
    if (!reactions || isEqual(reactions, previousReactions)) {
      return;
    }

    reactions.forEach(({ timestamp, demuxId, value }) => {
      showToast({
        key: `reactions-${timestamp}-${demuxId}`,
        onlyShowOnce: true,
        autoClose: true,
        content: (
          <span className="CallingReactionsToasts__reaction">
            <Emoji size={28} emoji={value} />
            {demuxId === localDemuxId
              ? i18n('icu:CallingReactions--me')
              : conversationsByDemuxId.get(demuxId)?.title}
          </span>
        ),
      });
    });
  }, [
    reactions,
    previousReactions,
    showToast,
    conversationsByDemuxId,
    localDemuxId,
    i18n,
  ]);
}

function CallingReactionsToastsContainer(
  props: CallingReactionsToastsType
): JSX.Element {
  const { i18n } = props;
  const toastRegionRef = useRef<HTMLDivElement>(null);
  return (
    <CallingToastProvider
      i18n={i18n}
      maxNonPersistentToasts={5}
      region={toastRegionRef}
      lifetime={CALLING_REACTIONS_LIFETIME}
      transitionFrom={REACTIONS_TOASTS_TRANSITION_FROM}
    >
      <div className="CallingReactionsToasts" ref={toastRegionRef} />
      <CallingReactionsToasts {...props} />
    </CallingToastProvider>
  );
}

function CallingReactionsToasts(props: CallingReactionsToastsType) {
  useReactionsToast(props);
  return null;
}
