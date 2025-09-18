import React, { useState } from 'react';

// メインアプリケーションコンポーネント
const App = () => {
  // 状態管理のためのuseStateフック
  const [selectedGrade, setSelectedGrade] = useState(null); // 選択された学年
  const [selectedSubject, setSelectedSubject] = useState(null); // 選択された教科
  const [selectedGenre, setSelectedGenre] = useState(null); // 選択されたジャンル
  const [problems, setProblems] = useState([]); // 現在の問題リスト
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0); // 現在の問題のインデックス
  const [userAnswers, setUserAnswers] = useState(['']); // ユーザーの入力（複数回答に対応するため配列に変更）
  const [message, setMessage] = useState(''); // ユーザーへのメッセージ（正解、不正解など）
  const [isCorrect, setIsCorrect] = useState(null); // 最後の回答が正解だったか
  const [correctCount, setCorrectCount] = useState(0); // 現在のクイズでの正解数
  const [difficultyLevel, setDifficultyLevel] = useState(3); // 難易度（1から5、最初は3から開始）
  const [isLoading, setIsLoading] = useState(false); // 問題生成中のローディング状態
  const [isAnswered, setIsAnswered] = useState(false); // 回答済みかどうかを追跡する新しい状態
  const [isCheckingAnswer, setIsCheckingAnswer] = useState(false); // 回答チェック中のローディング状態
  
  // APIキーは空文字列のままにしておいてください。実行時に自動で提供されます。
  const apiKey = "";
  // Gemini APIのエンドポイント
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
  
  // 指数バックオフ関数
  const exponentialBackoffFetch = async (url, options, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) {
          return response;
        } else if (response.status === 429) {
          // レート制限エラーの場合、リトライ
          console.warn(`Rate limit exceeded, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // 遅延を倍にする
        } else {
          // その他のエラーの場合、エラーをスロー
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        if (i === retries - 1) {
          throw error; // 最後の試行で失敗した場合、エラーをスロー
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  };

  // 生成された問題が合理的かを確認する非同期関数
  const verifyProblems = async (problemsToVerify, subject, grade, difficulty) => {
      setMessage('問題の合理性を確認中...');
      const checkPrompt = `
          以下の問題と解答のペアが、${grade}の${subject}向けとして妥当か、難易度${difficulty}に合っているか、解答が正確かを評価してください。
          
          問題:
          ${JSON.stringify(problemsToVerify, null, 2)}
          
          評価はJSON形式で返してください。
          { "is_reasonable": true } (問題が適切だと判断した場合)
          { "is_reasonable": false } (問題が不適切だと判断した場合)
      `;

      const payload = {
          contents: [{
              parts: [{ text: checkPrompt }]
          }],
          generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                  type: "OBJECT",
                  properties: {
                      "is_reasonable": { "type": "BOOLEAN" }
                  },
                  "propertyOrdering": ["is_reasonable"]
              }
          }
      };

      try {
          const response = await exponentialBackoffFetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          const result = await response.json();
          const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!jsonText) {
              return false;
          }
          const parsedJson = JSON.parse(jsonText);
          return parsedJson.is_reasonable;
      } catch (error) {
          console.error("問題の検証に失敗しました:", error);
          return false;
      }
  };

  // 問題を生成する非同期関数
  const generateProblems = async (grade, subject, genre, difficulty) => {
    setIsLoading(true);
    setMessage('新しい問題を作成中です...');

    let prompt;
    let payload;
    const gradeString = (typeof grade === 'number') ? `${grade}年生` : grade;

    // 教科と学年、ジャンルに応じたプロンプトとペイロードを動的に生成
    let genrePrompt = genre ? `ジャンルは「${genre}」です。` : '';

    switch(subject) {
      case '国語':
      case '社会':
        prompt = `
          小学生${gradeString}向けの${subject}の問題を3問作成してください。${genrePrompt}
          難易度レベルは${difficulty}です。
          レベル1: 簡単な用語や単語、ひらがな、カタカナ。
          レベル2: 少し複雑な用語、熟語、簡単な文法、身近な地域。
          レベル3: ことわざ、四字熟語、交通、日本の産業。
          レベル4: 物語文の読解、日本の歴史、政治の仕組み。
          レベル5: 詩や随筆の読解、複雑な時事問題、国際的な問題。
          問題と4つの選択肢、そして正解の選択肢のテキストをJSON形式で返してください。正解は選択肢のうちの1つでなければなりません。
        `;
        // JSONスキーマを定義して、レスポンスの構造を固定します
        payload = {
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  "question": { "type": "STRING" },
                  "options": {
                    "type": "ARRAY",
                    "items": { "type": "STRING" }
                  },
                  "answer": { "type": "STRING" }
                },
                "propertyOrdering": ["question", "options", "answer"]
              }
            }
          }
        };
        break;
      case '算数/数学':
        if (gradeString.startsWith('中')) {
          prompt = `
            中学${gradeString.charAt(gradeString.length - 1)}年生向けの数学の文章問題を3問作成してください。${genrePrompt}
            複数の答えが必要な問題も1問含めてください。答えは文字列または文字列の配列としてください。
            難易度レベルは${difficulty}です。
            レベル1: 正の数・負の数、文字式、一次方程式。
            レベル2: 連立方程式、一次関数、平行線と角。
            レベル3: 多項式の展開、因数分解、二次方程式、図形の証明。
            レベル4: 二次関数、円周角の定理、三平方の定理。
            レベル5: 複雑な応用問題、入試レベルの問題。
            問題と答えをJSON形式で返してください。
          `;
        } else {
          prompt = `
            小学生${gradeString}向けの算数の文章問題を3問作成してください。${genrePrompt}
            複数の答えが必要な問題も1問含めてください。答えは文字列または文字列の配列としてください。
            難易度レベルは${difficulty}です。
            レベル1: 簡単な足し算、引き算。
            レベル2: 少し複雑な足し算、引き算、簡単な掛け算。
            レベル3: 2桁の掛け算、簡単な割り算。
            レベル4: 複雑な割り算、分数の計算。
            レベル5: 複雑な文章題、図形の問題。
            問題と答えをJSON形式で返してください。
          `;
        }
        // JSONスキーマを定義して、レスポンスの構造を固定します
        payload = {
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  "question": { "type": "STRING" },
                  "answer": { "oneOf": [{ "type": "STRING" }, { "type": "ARRAY", "items": { "type": "STRING" } }] }
                },
                "propertyOrdering": ["question", "answer"]
              }
            }
          }
        };
        break;
      case '理科':
      case '英語':
        prompt = `
          小学生${gradeString}向けの${subject}の文章問題を3問作成してください。${genrePrompt}
          複数の答えが必要な問題も1問含めてください。答えは文字列または文字列の配列としてください。
          答えは日本語または英語のいずれか適切な方で答えること。
          ${subject === '英語' ? '回答形式の条件を問題文に含めてください。例：「Iから始まるように、3語で答えなさい。」「5語で答えなさい。」' : ''}
          複数のジャンルを混ぜて出題してください。
          難易度レベルは${difficulty}です。
          問題と答えをJSON形式で返してください。
        `;
        // JSONスキーマを定義して、レスポンスの構造を固定します
        payload = {
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  "question": { "type": "STRING" },
                  "answer": { "oneOf": [{ "type": "STRING" }, { "type": "ARRAY", "items": { "type": "STRING" } }] }
                },
                "propertyOrdering": ["question", "answer"]
              }
            }
          }
        };
        break;
      default:
        // デフォルトは算数
        prompt = `小学生${gradeString}向けの算数の問題を3問作成してください。`;
        payload = {
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  "question": { "type": "STRING" },
                  "answer": { "oneOf": [{ "type": "STRING" }, { "type": "ARRAY", "items": { "type": "STRING" } }] }
                },
                "propertyOrdering": ["question", "answer"]
              }
            }
          }
        };
    }

    try {
      const response = await exponentialBackoffFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      
      const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) {
        throw new Error("API response is empty or malformed.");
      }
      
      const parsedJson = JSON.parse(jsonText);

      // ここから合理性チェックのステップを追加
      const isReasonable = await verifyProblems(parsedJson, selectedSubject, gradeString, difficulty);
      
      if (isReasonable) {
        setProblems(parsedJson);
        setCurrentProblemIndex(0);
        setCorrectCount(0);
        setMessage('');
        const currentAnswer = parsedJson[0].answer;
        if (Array.isArray(currentAnswer)) {
          setUserAnswers(new Array(currentAnswer.length).fill(''));
        } else {
          setUserAnswers(['']);
        }
        setIsAnswered(false);
      } else {
        setMessage('不適切な問題が生成されました。再生成を試みます...');
        // 不適切と判断された場合は、再生成を試みる
        setTimeout(() => generateProblems(grade, subject, genre, difficulty), 2000);
      }
    } catch (error) {
      console.error("問題の生成に失敗しました:", error);
      setMessage('問題の生成中にエラーが発生しました。もう一度お試しください。');
      setProblems([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ユーザーの回答をチェックする非同期関数
  const handleAnswer = async (selectedOption = null) => {
    if (isAnswered) return; // 回答済みの場合は何もしない
    setIsCheckingAnswer(true);

    const currentProblem = problems[currentProblemIndex];
    let isAnswerCorrect = false;
    let allAnswersTrimmed = Array.isArray(userAnswers) ? userAnswers.map(ans => ans.trim()) : [userAnswers.trim()];

    // 教科によって回答チェック方法を分岐
    if (currentProblem.options) {
      // 選択肢方式の場合（国語、社会）
      const correctAnswer = currentProblem.answer;
      if (selectedOption !== null) {
        isAnswerCorrect = (selectedOption.trim() === correctAnswer.trim());
      }
    } else {
      // テキスト入力方式の場合（算数/数学、理科、英語）
      const correctAnswers = Array.isArray(currentProblem.answer) ? currentProblem.answer : [currentProblem.answer];

      if (allAnswersTrimmed.some(ans => ans === '')) {
        setMessage('全ての答えを入力してください。');
        setIsCheckingAnswer(false);
        return;
      }
      
      // ユーザーの回答を正確にチェックするためにAPIを呼び出す
      try {
          const checkPrompt = `
            問題: ${currentProblem.question}
            正解: ${correctAnswers.join(', ')}
            あなたの答え: ${allAnswersTrimmed.join(', ')}
            
            あなたの答えは正しいですか？はい、またはいいえで答えてください。
          `;
          
          const payload = {
              contents: [{
                  parts: [{ text: checkPrompt }]
              }]
          };
  
          const response = await exponentialBackoffFetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          const result = await response.json();
  
          const modelResponse = result?.candidates?.[0]?.content?.parts?.[0]?.text;
          
          // AIの回答に基づいて正誤を判断
          isAnswerCorrect = modelResponse?.trim().toLowerCase().includes('はい');
          
      } catch (error) {
          console.error("回答のチェックに失敗しました:", error);
          setMessage('回答の判断中にエラーが発生しました。');
          setIsCheckingAnswer(false);
          return;
      }
    }

    setIsCorrect(isAnswerCorrect);
    
    if (isAnswerCorrect) {
      setMessage('正解です！');
      setCorrectCount(prev => prev + 1);
    } else {
      const displayAnswer = Array.isArray(currentProblem.answer) ? currentProblem.answer.join(', ') : currentProblem.answer;
      setMessage(`残念！正解は "${displayAnswer}" でした。`);
    }

    setIsAnswered(true); // 回答済み状態に設定
    setIsCheckingAnswer(false);
  };

  // 次の問題へ進む関数
  const handleNextProblem = () => {
    // 最後の問題でなければ、次の問題へ進む
    if (currentProblemIndex < problems.length - 1) {
      setCurrentProblemIndex(prev => prev + 1);
      setMessage('');
      setIsCorrect(null);
      
      // 次の問題の回答数に応じて入力欄を初期化
      const nextAnswer = problems[currentProblemIndex + 1].answer;
      if (Array.isArray(nextAnswer)) {
        setUserAnswers(new Array(nextAnswer.length).fill(''));
      } else {
        setUserAnswers(['']);
      }

      setIsAnswered(false); // 次の問題で回答済み状態をリセット
    } else {
      // 3問のクイズが終了
      setMessage('3問のクイズが終了しました。');
      nextProblemSet();
    }
  };

  // 次の問題セットを決定し、生成する
  const nextProblemSet = () => {
    let nextDifficulty = difficultyLevel;
    // 3問中3問正解したら難易度アップ、そうでなければ難易度ダウン
    if (correctCount === problems.length) { // 正解数が問題数と一致する場合
      nextDifficulty = Math.min(difficultyLevel + 1, 5); // 最大難易度は5
    } else {
      nextDifficulty = Math.max(difficultyLevel - 1, 1); // 最小難易度は1
    }
    setDifficultyLevel(nextDifficulty);
    generateProblems(selectedGrade, selectedSubject, selectedGenre, nextDifficulty);
  };
  
  // 学年選択ボタンのハンドラー
  const handleGradeSelect = (grade) => {
    setSelectedGrade(grade);
  };

  // 教科選択ボタンのハンドラー
  const handleSubjectSelect = (subject) => {
    setSelectedSubject(subject);
    setSelectedGrade(null); // 教科を変えたら学年選択に戻る
    setSelectedGenre(null); // ジャンル選択もリセット
    setProblems([]); // 問題リストをクリア
    setCurrentProblemIndex(0); // 問題インデックスをリセット
  };

  // ジャンル選択ボタンのハンドラー
  const handleGenreSelect = (genre) => {
    setSelectedGenre(genre);
    setDifficultyLevel(3); // 新しいジャンルを選択したら難易度を3にリセット
    generateProblems(selectedGrade, selectedSubject, genre, 3);
  };
  
  // 難易度を強制的に1つ上げるボタンのハンドラー
  const handleDifficultyUp = () => {
    const newDifficulty = Math.min(difficultyLevel + 1, 5);
    setDifficultyLevel(newDifficulty);
    generateProblems(selectedGrade, selectedSubject, selectedGenre, newDifficulty);
  };

  // 難易度を強制的に1つ下げるボタンのハンドラー
  const handleDifficultyDown = () => {
    const newDifficulty = Math.max(difficultyLevel - 1, 1);
    setDifficultyLevel(newDifficulty);
    generateProblems(selectedGrade, selectedSubject, selectedGenre, newDifficulty);
  };

  // 難易度を星で表示するコンポーネント
  const StarRating = ({ level }) => {
    const filledStars = '★'.repeat(level);
    const emptyStars = '☆'.repeat(5 - level);
    return (
      <span className="text-xl text-yellow-500">
        {filledStars}{emptyStars}
      </span>
    );
  };
  
  // ジャンルのリストを定義
  const genres = {
    '国語': ['物語文', '説明文', '詩', '文法・語彙', '漢字・語句'],
    '算数/数学': ['計算', '文章題', '図形', '関数', '確率・統計'],
    '理科': ['生物', '化学', '物理', '地学'],
    '社会': ['地理', '歴史', '政治', '経済', '文化'],
    '英語': ['単語・文法', '会話', 'リスニング', '読解']
  };

  // 画面のレンダリング
  return (
    <div className="bg-gray-100 min-h-screen flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl text-center border-4 border-blue-400">
        <h1 className="text-3xl sm:text-4xl font-extrabold mb-8 text-blue-600">
          学習ドリル
        </h1>
        
        {/* 戻るボタン */}
        {selectedSubject && (
            <div className="flex justify-start mb-4">
              <button
                onClick={() => {
                  setSelectedSubject(null);
                  setSelectedGrade(null);
                  setSelectedGenre(null);
                  setProblems([]);
                  setCurrentProblemIndex(0);
                  setMessage('');
                }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-xl"
              >
                戻る
              </button>
            </div>
          )}

        {/* 教科選択画面 */}
        {!selectedSubject && (
          <div>
            <p className="text-lg mb-6 text-gray-700">まずは教科を選択</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {['国語', '算数/数学', '理科', '社会', '英語'].map(subject => (
                <button
                  key={subject}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-xl transition-transform transform hover:scale-105"
                  onClick={() => handleSubjectSelect(subject)}
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 学年選択画面 */}
        {selectedSubject && !selectedGrade && (
          <div>
            <p className="text-lg mb-6 text-gray-700">学年を選んでね！</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6].map(grade => (
                <button
                  key={grade}
                  className="bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-xl transition-transform transform hover:scale-105"
                  onClick={() => handleGradeSelect(grade)}
                >
                  {grade}年生
                </button>
              ))}
              {['中1', '中2', '中3'].map(grade => (
                <button
                  key={grade}
                  className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-4 px-6 rounded-xl transition-transform transform hover:scale-105"
                  onClick={() => handleGradeSelect(grade)}
                >
                  {grade}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ジャンル選択画面 */}
        {selectedGrade && selectedSubject && !selectedGenre && (
          <div>
            <p className="text-lg mb-6 text-gray-700">ジャンルを選んでね！</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {genres[selectedSubject] && genres[selectedSubject].map(genre => (
                <button
                  key={genre}
                  className="bg-teal-500 hover:bg-teal-600 text-white font-bold py-4 px-6 rounded-xl transition-transform transform hover:scale-105"
                  onClick={() => handleGenreSelect(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 問題画面 */}
        {selectedGenre && selectedGrade && selectedSubject && !isLoading && problems.length > 0 && (
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-800">
              {selectedGrade}の{selectedSubject}ドリル
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              難易度: <StarRating level={difficultyLevel} />
            </p>
            <div className="bg-blue-100 p-6 rounded-xl shadow-inner mb-6">
              <p className="text-xl sm:text-2xl font-semibold text-gray-900 mb-4">
                問題 {currentProblemIndex + 1} / 3:
              </p>
              <p className="text-xl sm:text-2xl font-semibold mb-6 text-indigo-700">
                {problems[currentProblemIndex]?.question}
              </p>

              {/* 回答形式を教科によって分岐 */}
              {problems[currentProblemIndex]?.options ? (
                // 選択肢方式（国語、社会）
                <div className="grid grid-cols-1 gap-4">
                  {problems[currentProblemIndex].options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleAnswer(option)}
                      disabled={isAnswered || isCheckingAnswer}
                      className={`py-4 px-6 rounded-xl font-bold transition-colors
                        ${isAnswered ?
                          (option === problems[currentProblemIndex].answer ? 'bg-green-600 text-white' : 'bg-gray-400 text-gray-700 cursor-not-allowed') :
                          'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                // テキスト入力方式（算数/数学、理科、英語）
                <div>
                  {/* 答えが配列の場合は複数の入力欄を生成 */}
                  {Array.isArray(problems[currentProblemIndex].answer) ? (
                    <div className="space-y-4">
                      {userAnswers.map((answer, index) => (
                        <input
                          key={index}
                          type="text"
                          value={answer}
                          onChange={(e) => {
                            const newAnswers = [...userAnswers];
                            newAnswers[index] = e.target.value;
                            setUserAnswers(newAnswers);
                          }}
                          disabled={isAnswered || isCheckingAnswer}
                          placeholder={`答え ${index + 1} を入力してください`}
                          className="w-full p-4 border-2 border-blue-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg sm:text-xl text-center disabled:bg-gray-200"
                        />
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={userAnswers[0]}
                      onChange={(e) => setUserAnswers([e.target.value])}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isCheckingAnswer) {
                          handleAnswer();
                        }
                      }}
                      disabled={isAnswered || isCheckingAnswer} // 回答済みまたはチェック中は入力欄を無効化
                      placeholder="ここに答えを入力してください"
                      className="w-full p-4 border-2 border-blue-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg sm:text-xl text-center disabled:bg-gray-200"
                    />
                  )}
                  {/* 解答ボタンまたは正誤メッセージ */}
                  {isAnswered ? (
                    <div className={`mt-4 w-full py-4 px-6 rounded-xl font-bold text-white transition-colors
                      ${isCorrect === true ? 'bg-green-500' : 'bg-red-500'}`}
                    >
                      {message}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleAnswer()}
                      disabled={isCheckingAnswer}
                      className={`mt-4 w-full py-4 px-6 rounded-xl font-bold text-white transition-colors
                        ${isCheckingAnswer ? 'bg-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}
                      `}
                    >
                      {isCheckingAnswer ? '判定中...' : '解答'}
                    </button>
                  )}
                </div>
              )}


              {/* 回答後に表示される「次の問題へ」ボタン */}
              {isAnswered && (
                <div className="mt-4">
                  <button
                    onClick={handleNextProblem}
                    className="w-full py-4 px-6 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 transition-colors"
                  >
                    次の問題へ
                  </button>
                </div>
              )}
              
              {/* 難易度調整ボタン */}
              <div className="mt-4 flex justify-center space-x-4">
                <button
                  onClick={handleDifficultyDown}
                  disabled={difficultyLevel <= 1}
                  className={`py-4 px-6 rounded-xl font-bold text-white transition-colors
                    ${difficultyLevel <= 1 ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600'}
                  `}
                >
                  難易度ダウン
                </button>
                <button
                  onClick={handleDifficultyUp}
                  disabled={difficultyLevel >= 5}
                  className={`py-4 px-6 rounded-xl font-bold text-white transition-colors
                    ${difficultyLevel >= 5 ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600'}
                  `}
                >
                  難易度アップ
                </button>
              </div>
            </div>

            {message && (
              <div className={`mt-4 p-4 rounded-xl font-bold text-white transition-opacity duration-500
                ${isCorrect === true ? 'bg-green-500' : isCorrect === false ? 'bg-red-500' : 'bg-gray-500'}
              `}>
                {message}
              </div>
            )}
          </div>
        )}

        {/* ローディング画面 */}
        {isLoading && (
          <div className="flex flex-col items-center">
            <div className="loader ease-linear rounded-full border-8 border-t-8 border-gray-200 h-24 w-24 mb-4"></div>
            <p className="text-lg font-bold text-blue-600 animate-pulse">
              問題作成中...
            </p>
          </div>
        )}

        {/* 問題が生成されていない場合やエラーの場合 */}
        {selectedGrade && selectedSubject && selectedGenre && !isLoading && problems.length === 0 && (
          <div className="text-red-500 font-bold">
            問題の取得に失敗しました。
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
