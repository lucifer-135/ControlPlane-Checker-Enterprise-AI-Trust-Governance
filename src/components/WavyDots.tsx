/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface WavyDotsProps {
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const WavyDots: React.FC<WavyDotsProps> = ({
  color = 'bg-[#4F46E5]',
  size = 'sm',
  className = '',
}) => {
  const sizeClasses = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }[size];

  return (
    <span className={`inline-flex items-center space-x-1.5 ${className}`} aria-label="Loading animation">
      <span className={`${sizeClasses} ${color} rounded-full animate-wave-dot-1 inline-block shadow-sm`} />
      <span className={`${sizeClasses} ${color} rounded-full animate-wave-dot-2 inline-block shadow-sm`} />
      <span className={`${sizeClasses} ${color} rounded-full animate-wave-dot-3 inline-block shadow-sm`} />
    </span>
  );
};
