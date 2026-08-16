import React, { useState, useRef } from 'react';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  maxTilt?: number;
}

export const TiltCard: React.FC<TiltCardProps> = ({
  children,
  className = '',
  onClick,
  maxTilt = 7
}) => {
  const [transformStyle, setTransformStyle] = useState<string>('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
  const [shadowStyle, setShadowStyle] = useState<string>('');
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Center coordinates
    const mouseX = e.clientX - rect.left - width / 2;
    const mouseY = e.clientY - rect.top - height / 2;

    // Calculate rotation angles
    const rotateX = (-mouseY / (height / 2)) * maxTilt;
    const rotateY = (mouseX / (width / 2)) * maxTilt;

    setTransformStyle(
      `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`
    );

    // Shadow shifts opposite to tilt direction
    const shadowX = (-rotateY * 1.5).toFixed(1);
    const shadowY = (rotateX * 1.5 + 8).toFixed(1);
    setShadowStyle(`${shadowX}px ${shadowY}px 25px rgba(0, 0, 0, 0.45)`);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // Spring back easing curve over 300ms
    setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setShadowStyle('');
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`transition-all duration-300 ${isHovered ? 'ease-out' : 'ease-[cubic-bezier(0.175,0.885,0.32,1.275)]'} ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      style={{
        transform: transformStyle,
        boxShadow: shadowStyle,
        transformStyle: 'preserve-3d'
      }}
    >
      {children}
    </div>
  );
};
