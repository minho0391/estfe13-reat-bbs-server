const express = require("express");
const cors = require("cors");
const app = express();
const mysql = require("mysql2");
const port = process.env.PORT || 3000;
const multer = require("multer");
const fs = require("fs");
const path = require("path");

app.use(express.json()); // json -> object
app.use(express.urlencoded({ extended: true })); // html form -> object

// uploads 폴더를 브라우저에서 접근 가능하게 열어줌
// 예: http://서버주소:3000/uploads/파일명.jpg
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

let corsOptions = {
  origin: "*",
};

app.use(cors(corsOptions));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: function (req, file, cb) {
    const originalExt = path.extname(file.originalname);
    const uniquePrefix = Date.now() + "-" + Math.round(Math.random() * 1000);

    cb(null, uniquePrefix + "-" + file.fieldname + originalExt);
  },
});

const upload = multer({ storage: storage });

const db = mysql.createConnection({
  host: "localhost",
  user: "bbs_user",
  password: "12345",
  database: "bbs",
});

db.connect();

function deleteUploadedFile(filePath) {
  if (!filePath) return;

  // DB에 예전처럼 /home/.../uploads/파일명.jpg 가 들어있어도
  // 새 방식처럼 /uploads/파일명.jpg 가 들어있어도
  // 파일명만 뽑아서 서버 uploads 폴더에서 삭제
  const fileName = path.basename(filePath);
  const absolutePath = path.join(__dirname, "uploads", fileName);

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
    console.log("이미지 삭제 완료:", absolutePath);
  } else {
    console.log("삭제할 이미지가 없습니다:", absolutePath);
  }
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/list", (req, res) => {
  const sqlQuery =
    "SELECT id, title, content, writer, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM board;";

  db.query(sqlQuery, (err, result) => {
    if (err) throw err;

    res.send(result);
  });
});

app.get("/view", (req, res) => {
  console.log(req.query.id);

  const id = req.query.id;

  const sqlQuery =
    "SELECT title, content, writer, image_path, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM board WHERE id=?;";

  db.query(sqlQuery, [id], (err, result) => {
    if (err) throw err;

    res.send(result);
  });
});

app.post("/write", upload.single("image"), (req, res) => {
  console.log(req.body);

  const { title, writer, content } = req.body;

  // 중요:
  // req.file.path는 서버 내부 절대경로라 브라우저에서 접근 불가
  // DB에는 브라우저에서 접근 가능한 URL 경로 형태로 저장
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const sqlQuery = "INSERT INTO board (title, content, writer, image_path) VALUES (?, ?, ?, ?);";

  db.query(sqlQuery, [title, content, writer, imagePath], (err, result) => {
    if (err) throw err;

    res.send(result);
  });
});

app.post("/delete", (req, res) => {
  console.log(req.body);

  const { id } = req.body;

  // 1. 글 번호로 삭제할 이미지의 경로 파악
  db.query("SELECT image_path FROM board WHERE id=?", [id], (err, rows) => {
    if (err) throw err;

    const existingImagePath = rows[0]?.image_path;

    // 2. 서버 uploads 폴더에서 이미지 삭제
    deleteUploadedFile(existingImagePath);

    // 3. 테이블에서 글 삭제
    db.query("DELETE FROM board WHERE id=?", [id], (err, result) => {
      if (err) throw err;

      res.send(result);
    });
  });
});

app.post("/deleteselect", (req, res) => {
  console.log(req.body);

  const { boardIdList } = req.body;

  // 선택된 글이 없을 경우 종료
  if (!boardIdList || boardIdList.length === 0) {
    return res.send({ message: "삭제할 글이 없습니다." });
  }

  // 예: [1, 3, 5] -> "?, ?, ?"
  const placeholders = boardIdList.map(() => "?").join(",");

  // 1. 여러 게시글의 이미지 경로 조회
  db.query(
    `SELECT image_path FROM board WHERE id IN (${placeholders})`,
    boardIdList,
    (err, rows) => {
      if (err) throw err;

      // 2. 서버 uploads 폴더의 이미지들 삭제
      rows.forEach(item => {
        deleteUploadedFile(item.image_path);
      });

      // 3. 테이블에서 여러 글 삭제
      db.query(`DELETE FROM board WHERE id IN (${placeholders})`, boardIdList, (err, result) => {
        if (err) throw err;

        res.send(result);
      });
    },
  );
});

app.post("/update", upload.single("image"), (req, res) => {
  console.log(req.body);

  const { writer, title, content, id, remove_image } = req.body;

  // 새 이미지도 DB에는 브라우저 접근용 경로로 저장
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const shouldRemoveImage = remove_image === "1";

  // 1. 수정 전 기존 이미지 경로 조회
  db.query("SELECT image_path FROM board WHERE id=?", [id], (err, rows) => {
    if (err) throw err;

    const existingImagePath = rows[0]?.image_path;

    let sqlQuery;
    let params;

    // 이미지 삭제 요청 O + 새 이미지 X
    if (shouldRemoveImage && !imagePath) {
      // 기존 서버 이미지 삭제
      deleteUploadedFile(existingImagePath);

      // DB image_path 값 비우기
      sqlQuery = "UPDATE board SET writer=?, title=?, content=?, image_path=NULL WHERE id=?";
      params = [writer, title, content, id];
    }

    // 새 이미지 O
    else if (imagePath) {
      // 기존 이미지가 있다면 서버에서 삭제
      deleteUploadedFile(existingImagePath);

      // 새 이미지 경로로 변경
      sqlQuery = "UPDATE board SET writer=?, title=?, content=?, image_path=? WHERE id=?";
      params = [writer, title, content, imagePath, id];
    }

    // 이미지 삭제 요청 X + 새 이미지 X
    else {
      // 이미지는 그대로 유지하고 글 정보만 수정
      sqlQuery = "UPDATE board SET writer=?, title=?, content=? WHERE id=?";
      params = [writer, title, content, id];
    }

    // 2. 글 정보 수정
    db.query(sqlQuery, params, (err, result) => {
      if (err) throw err;

      res.send(result);
    });
  });
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
