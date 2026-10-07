import { renderToStaticMarkup } from 'react-dom/server';

import { userColorsForId } from '../userColors';

import { AvatarSvg } from './AvatarSvg';

const getInitialFromName = (name: string) => {
  const splitName = name?.split(' ');
  return (splitName[0]?.charAt(0) || '?') + (splitName?.[1]?.charAt(0) || '');
};

type UserAvatarProps = {
  userId?: string;
  fullName?: string;
  background?: string;
};

export const UserAvatar = ({
  userId,
  fullName,
  background,
}: UserAvatarProps) => {
  const name = fullName?.trim() || '?';

  return (
    <AvatarSvg
      className="--docs--user-avatar"
      initials={getInitialFromName(name).toUpperCase()}
      background={background || userColorsForId(userId ?? name).color}
      foreground={background ? undefined : '#1f2937'}
    />
  );
};

export const avatarUrlFromName = (
  fullName?: string,
  fontFamily?: string,
  userId?: string,
): string => {
  const name = fullName?.trim() || '?';
  const initials = getInitialFromName(name).toUpperCase();
  const background = userColorsForId(userId ?? name).color;

  const svgMarkup = renderToStaticMarkup(
    <AvatarSvg
      className="--docs--user-avatar"
      initials={initials}
      background={background}
      foreground="#1f2937"
      fontFamily={fontFamily}
    />,
  );

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgMarkup)}`;
};
