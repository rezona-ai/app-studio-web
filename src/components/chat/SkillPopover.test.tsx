import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SkillPopover from './SkillPopover';
import '@/i18n';

const sk = (name: string, prefix = '/') => ({ name, invocation: `${prefix}${name}` });

describe('SkillPopover', () => {
  it('渲染已登记 skill 的显示名/胶囊/描述与底部提示', () => {
    render(<SkillPopover list={[sk('plan')]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('Game Design')).toBeInTheDocument();
    expect(screen.getByText('/plan')).toBeInTheDocument();
    expect(screen.getByText('Produce game design documents')).toBeInTheDocument();
    expect(screen.getByText('The agent will automatically invoke these skills.')).toBeInTheDocument();
  });
  it('未登记 slug 降级:显示名=slug,无描述', () => {
    render(<SkillPopover list={[sk('mystery')]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(screen.getByText('/mystery')).toBeInTheDocument();
  });
  it('空列表显示空态', () => {
    render(<SkillPopover list={[]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('No matching skill')).toBeInTheDocument();
  });
  it('mousedown 选择并回传 slug', () => {
    const onPick = vi.fn();
    render(<SkillPopover list={[sk('plan'), sk('cutout')]} activeIndex={0} onPick={onPick} />);
    fireEvent.mouseDown(screen.getByText('Smart Cutout'));
    expect(onPick).toHaveBeenCalledWith(sk('cutout'));
  });
});
