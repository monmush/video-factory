// Sample stories for fixture mode, so the script board can be tried without AI.
// Taken from prototypes/batch-script-review; illustrative, not approved by Hy An.
// Lines alternate between the series' first and second character.

export interface FixtureStory {
  title: string;
  hook: string;
  lines: string[];
}

export const FIXTURE_STORIES: FixtureStory[] = [
  {
    title: "Tự thưởng",
    hook: "Làm xong mới được uống trà sao?",
    lines: [
      "Con chưa đạt mục tiêu, có được nghỉ không ông?",
      "Con đã cố gắng hôm nay chưa?",
      "Dạ rồi, nhưng chưa đủ.",
      "Vậy chén trà này mừng sự cố gắng. Mai mình tiếp tục.",
    ],
  },
  {
    title: "Hỏi đường",
    hook: "Không biết đường có đáng ngại?",
    lines: [
      "Con ngại hỏi, sợ người ta nghĩ con kém.",
      "Lạc đường mà im thì giỏi hơn à?",
      "Chắc chỉ lạc lâu hơn thôi ạ.",
      "Hỏi đi. Ai cũng từng chưa biết pha chén trà đầu tiên.",
    ],
  },
  {
    title: "Đổi ý",
    hook: "Hôm qua thích đậm, hôm nay thích nhạt có sao?",
    lines: [
      "Hôm qua con nói thích trà đậm, giờ lại muốn nhạt.",
      "Thì hôm nay ta pha nhạt.",
      "Ông không bảo con thiếu kiên định à?",
      "Khẩu vị thay đổi… đâu phải thất hứa.",
    ],
  },
  {
    title: "Cơ hội",
    hook: "Cửa chưa gõ, sao biết không mở?",
    lines: [
      "Con muốn xin công việc ấy, mà sợ bị từ chối.",
      "Con đã gửi lời chưa?",
      "Chưa ông ạ.",
      "Vậy người từ chối con đầu tiên… đang là con đấy.",
    ],
  },
  {
    title: "Chọn bạn",
    hook: "Ngồi với ai thì trà cũng ngọt?",
    lines: [
      "Cùng loại trà mà hôm nay con thấy ngon hơn.",
      "Hôm nay con có phải gồng mình không?",
      "Không, con được nói thật.",
      "Có khi thứ làm trà ngon là người ngồi cùng.",
    ],
  },
  {
    title: "Kiểm chứng",
    hook: "Nghe đồn trà đắng đã tin ngay?",
    lines: [
      "Người ta bảo trà này khó uống lắm.",
      "Con đã nhấp chưa?",
      "Chưa, con nghe kể thôi.",
      "Vậy để lưỡi mình góp ý trước nhé.",
    ],
  },
  {
    title: "Không biết",
    hook: "Ba chữ khó nói nhất có phải là không biết?",
    lines: [
      "Loại trà này pha bao lâu hả ông?",
      "Ta chưa biết loại này. Mình đọc hướng dẫn nhé.",
      "Con tưởng ông biết hết.",
      "Biết mình chưa biết… cũng tiết kiệm được một ấm hỏng.",
    ],
  },
  {
    title: "Vội kết luận",
    hook: "Nước trong đã chắc trà nhạt?",
    lines: [
      "Màu nhạt thế này chắc không ngon.",
      "Con thử ngửi xem.",
      "Thơm thật ông ạ.",
      "Nhìn một mặt thôi dễ bỏ lỡ nhiều điều.",
    ],
  },
  {
    title: "Phê bình",
    hook: "Chê trà hay chê người pha?",
    lines: [
      "Ông thấy con pha tệ không?",
      "Nước hôm nay hơi nóng, thử giảm chút nhé.",
      "Ông không chê con à?",
      "Ta đang nói về ấm trà, đâu phải chấm điểm con.",
    ],
  },
  {
    title: "Nỗi nhớ",
    hook: "Giữ chiếc chén cũ để làm gì?",
    lines: [
      "Chén cũ rồi, sao ông không đổi?",
      "Bạn ta tặng khi còn trẻ.",
      "Nó có pha trà ngon hơn không?",
      "Không… nhưng mỗi lần nâng chén ta nhớ một người.",
    ],
  },
  {
    title: "Bắt đầu muộn",
    hook: "Giờ mới học pha trà có muộn?",
    lines: [
      "Con thấy ai cũng bắt đầu trước mình.",
      "Nếu hôm nay không bắt đầu thì mai có sớm hơn không?",
      "Không ạ.",
      "Vậy rót chén đầu tiên đi.",
    ],
  },
  {
    title: "Sự chú ý",
    hook: "Hương trà nhỏ thế sao ông nhận ra?",
    lines: [
      "Ngày nào cũng uống mà con không thấy khác.",
      "Thử bỏ điện thoại xuống, ngửi trước khi nhấp.",
      "À, hôm nay thơm dịu hơn.",
      "Điều nhỏ không phải lúc nào cũng tự lên tiếng.",
    ],
  },
];
