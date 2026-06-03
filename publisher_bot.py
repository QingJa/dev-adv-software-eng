#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多智能体健康饮食规划系统 - 社交平台自动发布助手 (publisher_bot.py)
使用 Playwright 自动化上传生成的宣传短视频及推广软文到小红书或抖音创作者平台。
首次运行需扫码登录，登录状态会自动保存至本地 json 文件中，后续可免登录运行。
"""

import os
import sys
import json
import argparse
import time
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("错误: 缺少 playwright 依赖库，请先安装: pip install playwright")
    print("并运行: playwright install")
    sys.exit(1)

# 获取当前工作目录
CWD = Path(__file__).resolve().parent

def load_publish_data(json_path):
    """加载前端导出的发布包数据"""
    if not os.path.exists(json_path):
        print(f"错误: 找不到发布数据文件 '{json_path}'。请先在网页端下载发布包并解压至此。")
        sys.exit(1)
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"读取数据文件失败: {e}")
        sys.exit(1)

def run_xiaohongshu(data, video_path):
    """小红书自动发布流程"""
    state_file = CWD / "xhs_state.json"
    
    print("\n[+] 正在启动小红书自动发布助手...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # 必须使用有头模式以便扫码
        
        # 尝试加载之前的登录状态
        if state_file.exists():
            print("[+] 检测到本地已存小红书登录状态，正在尝试免密载入...")
            context = browser.new_context(storage_state=str(state_file))
        else:
            print("[+] 未检测到登录状态，开启全新会话...")
            context = browser.new_context()

        page = context.new_page()
        
        # 打开小红书发布页面
        print("[+] 正在访问小红书发布入口...")
        page.goto("https://creator.xiaohongshu.com/publish/publish")
        
        # 检查是否在登录页面
        if page.url.startswith("https://creator.xiaohongshu.com/login"):
            print("\n=======================================================")
            print("⚠️  请在弹出的浏览器中扫描二维码登录小红书创作者平台...")
            print("=======================================================")
            # 等待登录成功跳转到发布页
            page.wait_for_url("https://creator.xiaohongshu.com/publish/publish", timeout=120000)
            print("[+] 登录成功！正在保存登录状态到 xhs_state.json...")
            context.storage_state(path=str(state_file))
        
        # 等待页面加载完毕
        page.wait_for_selector(".upload-wrapper, input[type='file']", timeout=30000)
        print("[+] 发布页面加载成功，准备上传视频...")

        # 1. 上传视频
        file_input = page.locator("input[type='file']")
        file_input.set_input_files(video_path)
        print(f"[+] 视频文件 {os.path.basename(video_path)} 已添加，正在上传...")

        # 等待视频上传并解析成功 (通常会出现标题输入框)
        page.wait_for_selector(".title-input input, input[placeholder*='填写标题']", timeout=60000)
        print("[+] 视频上传完毕！开始填写文案数据...")

        # 2. 填写标题
        title = f"AI智能体定制：{data['plan_name']}"
        title_box = page.locator(".title-input input, input[placeholder*='填写标题']").first
        title_box.fill(title[:20])  # 小红书标题限20字
        print(f"[+] 标题已填写: {title[:20]}")

        # 3. 填写描述/正文
        desc_box = page.locator(".content-textarea, #post-textarea, .editor-wrapper [contenteditable='true']").first
        desc_box.focus()
        desc_box.fill(data['xhs_text'])
        print("[+] 描述正文与话题已填入。")

        # 4. 提示用户人工确认
        print("\n=======================================================")
        print("🎉  小红书自动填充完成！")
        print("ℹ️  为确保安全，机器人不会自动点击【发布】。")
        print("👉  请在浏览器中核对视频和文案，无误后手动点击页面底部的【发布】按钮。")
        print("=======================================================")
        
        # 保持浏览器打开，直到用户手动关闭
        while True:
            if browser.contexts == []:
                break
            time.sleep(1)

def run_douyin(data, video_path):
    """抖音自动发布流程"""
    state_file = CWD / "dy_state.json"
    
    print("\n[+] 正在启动抖音自动发布助手...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        
        # 尝试加载之前的登录状态
        if state_file.exists():
            print("[+] 检测到本地已存抖音登录状态，正在尝试免密载入...")
            context = browser.new_context(storage_state=str(state_file))
        else:
            print("[+] 未检测到登录状态，开启全新会话...")
            context = browser.new_context()

        page = context.new_page()
        
        # 打开抖音上传页面
        print("[+] 正在访问抖音创作者平台上传入口...")
        page.goto("https://creator.douyin.com/creator-micro/content/upload")
        
        # 检测是否需要登录 (URL 包含 login 或是没有直接进入上传页)
        if "login" in page.url or page.locator("text=验证码").count() > 0 or page.locator("text=扫码登录").count() > 0:
            print("\n=======================================================")
            print("⚠️  请在弹出的浏览器中扫描二维码登录抖音创作者服务平台...")
            print("=======================================================")
            # 等待登录成功跳转到上传页
            page.wait_for_url("https://creator.douyin.com/creator-micro/content/upload", timeout=120000)
            print("[+] 登录成功！正在保存登录状态到 dy_state.json...")
            context.storage_state(path=str(state_file))
        
        # 等待上传组件加载
        page.wait_for_selector("input[type='file']", timeout=30000)
        print("[+] 上传页面就绪，准备上传视频...")

        # 1. 上传视频
        file_input = page.locator("input[type='file']").first
        file_input.set_input_files(video_path)
        print(f"[+] 视频文件 {os.path.basename(video_path)} 已添加，正在上传并转码...")

        # 等待跳转到发布编辑页或显示标题/描述输入框
        # 抖音上传后会展示一个编辑区
        page.wait_for_selector(".editor-kit-container, .editor-container, textarea[placeholder*='好的作品']", timeout=90000)
        print("[+] 视频上传解析成功！开始填充描述文案...")

        # 2. 填写视频描述
        desc_box = page.locator(".editor-kit-container [contenteditable='true'], textarea[placeholder*='好的作品']").first
        desc_box.focus()
        # 清空默认生成的内容 (如有)
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        
        # 写入抖音文案并加上话题
        desc_box.fill(data['video_desc'])
        print("[+] 视频描述及推广话题已填入。")

        # 3. 提示确认
        print("\n=======================================================")
        print("🎉  抖音视频与文案填充完成！")
        print("ℹ️  为安全起见，发布按钮需要您手动确认。")
        print("👉  请在浏览器内完成分类标签、发布时间等微调后，手动点击【发布】。")
        print("=======================================================")
        
        # 保持浏览器打开
        while True:
            if browser.contexts == []:
                break
            time.sleep(1)

def main():
    parser = argparse.ArgumentParser(description="多智能体健康饮食系统 - 自动发布助手")
    parser.add_argument("-p", "--platform", choices=["xhs", "dy"], required=True, 
                        help="发布的目标平台: xhs (小红书), dy (抖音)")
    parser.add_argument("-d", "--data", default="publish_data.json", 
                        help="前端导出的 publish_data.json 路径")
    parser.add_argument("-v", "--video", default="promo_video.webm", 
                        help="前端生成的视频 promo_video.webm 路径")
    
    args = parser.parse_args()

    # 校对文件路径
    json_path = os.path.abspath(args.data)
    video_path = os.path.abspath(args.video)

    if not os.path.exists(video_path):
        # 尝试在当前目录下直接找
        alternative_video = os.path.join(os.path.dirname(json_path), "promo_video.webm")
        if os.path.exists(alternative_video):
            video_path = alternative_video
        else:
            print(f"错误: 找不到视频文件 '{video_path}'。请在前端点击【生成并下载宣传视频】后重试。")
            sys.exit(1)

    print(f"=======================================================")
    print(f"🚀 启动自动发布流 | 目标平台: {'小红书' if args.platform == 'xhs' else '抖音'}")
    print(f"📦 数据文件: {json_path}")
    print(f"🎬 视频文件: {video_path}")
    print(f"=======================================================")

    data = load_publish_data(json_path)

    if args.platform == "xhs":
        run_xiaohongshu(data, video_path)
    elif args.platform == "dy":
        run_douyin(data, video_path)

if __name__ == "__main__":
    main()
