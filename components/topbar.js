
import React from 'react'
import ReactDOM from 'react-dom'

export default class Topbar extends React.Component {
  constructor(props) {
    super(props);
    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.sortByTitle = this.sortByTitle.bind(this);
    this.sortByYear = this.sortByYear.bind(this);
    this.sortByRating = this.sortByRating.bind(this);
  }

  handleSearchChange(e) {
    this.props.onSearchChange(e.target.value);
  }

  sortByTitle(e) {
    let sortby = this.props.sortBy;
    if (sortby[0] == 'title')
      sortby[1] *= -1;
    sortby[0] = 'title';
    this.props.onSortChange(sortby);
  }

  sortByYear(e) {
    let sortby = this.props.sortBy;
    if (sortby[0] == 'year')
      sortby[1] *= -1;
    sortby[0] = 'year';
    this.props.onSortChange(sortby);
  }

  sortByRating(e) {
    let sortby = this.props.sortBy;
    if (sortby[0] == 'imdb.rating')
      sortby[1] *= -1;
    sortby[0] = 'imdb.rating';
    this.props.onSortChange(sortby);
  }


  render() {
    let sortClass = "";
    if (this.props.sortBy[0] == 'imdb.rating')
        sortClass += "rating "
    else
        sortClass += this.props.sortBy[0] + " "

    sortClass += (this.props.sortBy[1] > 0) ? "asc" : "desc";
    
    return (
		    <div id="topbar">
			    <input id="searchbar" name="search" type="text" value={this.props.searchQuery} onChange={this.handleSearchChange} />
          <div id="sort" className={sortClass}>
            <div className="sort-option sortby-title" onClick={this.sortByTitle}>Title</div>
            <div className="sort-option sortby-year" onClick={this.sortByYear}>Year</div>
            <div className="sort-option sortby-rating" onClick={this.sortByRating}>Rating</div>
          </div>
		    </div>
    );
  }
}