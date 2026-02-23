@echo off
cd /d "c:\Users\FAMILY\Desktop\tetra aion2"

git init
git add .
git commit -m "TETRA Sync Bot" 2>nul
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/vacagencydev-ringring/tetra.git
git push -u origin main --force

pause
